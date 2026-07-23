const PLANET_ORDER = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];
const PLANET_COLOR = {
  mercury: "#c9a876",
  venus: "#e8b34d",
  earth: "#4da3e8",
  mars: "#e8664d",
  jupiter: "#d9a06b",
  saturn: "#e0c98a",
  uranus: "#7fd9e8",
  neptune: "#5f7fe8",
};
const CHATTER_LINES = ["Banana!", "Bee-do bee-do!", "Poopaye!", "Tank yu!", "Papoy!", "Bapple!", "Eh eh eh!", "La bufo!"];
const GRU_ASPECT = 666 / 1524; // source cutout's width:height ratio (public/assets/gru.png)

function generateStars(n) {
  const stars = [];
  for (let i = 0; i < n; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.3 + 0.3,
      tw: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.15 + 0.03,
    });
  }
  return stars;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}
function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class SwarmSim {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.stars = generateStars(140);
    this.comets = [];
    this.nextCometAt = performance.now() + 2000;
    this.nextChatterAt = performance.now() + 4000;
    this.shake = { mag: 0, until: 0 };
    this.ships = new Map(
      PLANET_ORDER.map((name) => [
        name,
        {
          name,
          pop: 1000,
          maxPopEver: 1000,
          traits: {},
          extinct: false,
          bottleneckActive: false,
          contestedNiche: false,
          thinking: false,
          hazardForecast: null,
          flash: null, // { color, until }
          label: null, // { text, color, until, bornAt }
        },
      ])
    );
    this.effects = [];
    this.epochNumber = 0;
    this.multiplier = 1;
    this.running = false;
    this.gruFireUntil = 0;

    this.log = [];
    this.logEl = document.getElementById("log");
    this.leaderboardEl = document.querySelector("#leaderboard tbody");
    this.dominionText = document.getElementById("dominion-text");
    this.dominionFill = document.getElementById("dominion-fill");

    this.gruImg = new Image();
    this.gruImgLoaded = false;
    this.gruImg.onload = () => {
      this.gruImgLoaded = true;
    };
    this.gruImg.src = "assets/gru.png";
  }

  updateUsage(usage) {
    if (!usage) return;
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set("u-coord-calls", usage.coordinator.calls);
    set("u-coord-in", usage.coordinator.inputTokens.toLocaleString());
    set("u-coord-out", usage.coordinator.outputTokens.toLocaleString());
    set("u-coord-cache", `${usage.coordinator.cacheReadTokens}/${usage.coordinator.cacheWriteTokens}`);
    set("u-spec-calls", usage.specialists.calls);
    set("u-spec-in", usage.specialists.inputTokens.toLocaleString());
    set("u-spec-out", usage.specialists.outputTokens.toLocaleString());
    set("u-spec-cache", `${usage.specialists.cacheReadTokens}/${usage.specialists.cacheWriteTokens}`);
    set("u-total-cost", `$${usage.total.costUSD.toFixed(6)}`);
    set("u-total-calls", `(${usage.total.calls} calls)`);
  }

  addLog(html) {
    this.log.push(html);
    if (this.log.length > 150) this.log.shift();
    const div = document.createElement("div");
    div.className = "entry";
    div.innerHTML = html;
    this.logEl.appendChild(div);
    while (this.logEl.children.length > 150) this.logEl.removeChild(this.logEl.firstChild);
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  addEffect(effect) {
    this.effects.push({ startedAt: performance.now(), ...effect });
  }

  setLabel(ship, text, color, durationMs = 4000) {
    ship.label = { text, color, until: performance.now() + durationMs, bornAt: performance.now(), duration: durationMs };
  }

  triggerShake(mag, durationMs) {
    this.shake = { mag, until: performance.now() + durationMs };
  }

  updateDominion(dominion) {
    if (!dominion) return;
    const prevPct = this.dominion ? this.dominion.pct : dominion.pct;
    this.dominion = dominion;
    if (this.dominionText) this.dominionText.textContent = `${Math.round(dominion.total)} / ${dominion.target} POP`;
    if (this.dominionFill) this.dominionFill.style.width = `${Math.round(dominion.pct * 100)}%`;

    // Dominion isn't just a number — real growth (or a real setback) rattles the
    // galaxy and the fleet visibly spreads out to hold more territory (layoutPositions
    // eases toward a wider radius as dominion.pct rises; see targetSpread below).
    const delta = dominion.pct - prevPct;
    if (Math.abs(delta) > 0.01) {
      this.triggerShake(Math.min(14, 3 + Math.abs(delta) * 60), 320);
    }
  }

  layoutPositions() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const cx = w * 0.5;
    const cy = h * 0.62;
    const targetSpread = 1 + (this.dominion ? this.dominion.pct : 0) * 0.45;
    this.spread = lerp(this.spread ?? 1, targetSpread, 0.03);
    const R = Math.min(w, h) * 0.32 * this.spread;
    const positions = {};
    PLANET_ORDER.forEach((name, i) => {
      const angle = -Math.PI / 2 + (i / PLANET_ORDER.length) * Math.PI * 2;
      positions[name] = {
        x: cx + Math.cos(angle) * R,
        y: cy + Math.sin(angle) * R * 0.72,
      };
    });

    // Gru's portrait (public/assets/gru.png) — tall cutout, aspect ratio fixed to source.
    const headTop = 78; // just under the topbar
    const gruH = Math.max(160, Math.min(w, h) * 0.38);
    const gruW = gruH * GRU_ASPECT;
    const gruDrawX = cx - gruW / 2;
    this.gruDraw = { x: gruDrawX, y: headTop, w: gruW, h: gruH };
    // Beam/annihilation origin: his raised raygun, near the top-left of the portrait.
    this.gruShipPos = {
      x: gruDrawX + gruW * 0.16,
      y: headTop + gruH * 0.07,
      r: Math.min(w, h) * 0.09,
    };
    this._positions = positions;
    return positions;
  }

  posOf(planet) {
    const ship = this.ships.get(planet);
    if (ship && ship.manualPos) return ship.manualPos;
    return (this._positions && this._positions[planet]) || this.layoutPositions()[planet];
  }

  // ---- dragging ----
  onPointerDown(x, y) {
    for (const name of PLANET_ORDER) {
      const p = this.posOf(name);
      if (p && Math.hypot(p.x - x, p.y - y) < 30) {
        this.draggingPlanet = name;
        this.canvas.style.cursor = "grabbing";
        return true;
      }
    }
    return false;
  }

  onPointerMove(x, y) {
    if (!this.draggingPlanet) return;
    const ship = this.ships.get(this.draggingPlanet);
    if (!ship) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ship.manualPos = { x: Math.max(24, Math.min(w - 24, x)), y: Math.max(24, Math.min(h - 24, y)) };
  }

  onPointerUp() {
    if (this.draggingPlanet) {
      this.draggingPlanet = null;
      this.canvas.style.cursor = "grab";
    }
  }

  // ---- WS message handling ----
  handleMessage(msg) {
    switch (msg.type) {
      case "snapshot": {
        this.running = !!msg.running;
        this.epochNumber = msg.epochNumber || 0;
        document.getElementById("epoch-num").textContent = this.epochNumber;
        for (const [name, a] of Object.entries(msg.agents || {})) {
          const ship = this.ships.get(name);
          if (!ship) continue;
          ship.pop = a.POP;
          ship.maxPopEver = Math.max(ship.maxPopEver, a.POP);
          ship.traits = a.traits;
          ship.extinct = a.extinct;
          ship.bottleneckActive = a.bottleneckEpochsLeft > 0;
        }
        this.renderLeaderboard(msg.leaderboard || []);
        this.updateDominion(msg.dominion);
        this.updateUsage(msg.usage);
        this.updateSimStateButtons(msg.speed);
        break;
      }
      case "usage_update": {
        this.updateUsage(msg);
        break;
      }
      case "sim_state": {
        this.running = !!msg.running;
        this.updateSimStateButtons(msg.speed);
        break;
      }
      case "epoch_forecast": {
        this.epochNumber = msg.epochNumber;
        this.multiplier = msg.multiplier;
        document.getElementById("epoch-num").textContent = this.epochNumber;
        document.getElementById("epoch-mult").textContent = `${this.multiplier.toFixed(2)}×`;
        for (const [planet, f] of Object.entries(msg.forecasts || {})) {
          const ship = this.ships.get(planet);
          if (ship) ship.hazardForecast = f;
        }
        this.updateDominion(msg.dominion);
        this.addLog(
          `<span class="tag-forecast">◇ EPOCH ${msg.epochNumber}</span> hazard forecasts in — severity unknown (fog of war)`
        );
        break;
      }
      case "coordinator_dispatch": {
        this.addLog(
          `<span class="tag-gru">GRU</span> <span class="tag-dispatch">→ single message, ${msg.dispatches.length} garrisons dispatched</span> (${msg.coordinatorLatencyMs}ms)`
        );
        for (const d of msg.dispatches) {
          const ship = this.ships.get(d.planet);
          if (!ship) continue;
          ship.thinking = true;
          this.setLabel(ship, d.orderText, "#c9b6ff", 4200);
          this.addEffect({ type: "dispatch_beam", planet: d.planet, duration: 550 });
        }
        break;
      }
      case "specialist_start":
        break; // visualized already via coordinator_dispatch beams landing
      case "specialist_done": {
        const ship = this.ships.get(msg.planet);
        if (ship) {
          ship.thinking = false;
          const raidNote = msg.action.raid ? `  ⚔→${msg.action.raid.target}` : "";
          this.setLabel(ship, msg.action.battleCry + raidNote, "#ffd400", 4200);
        }
        this.addEffect({ type: "response_beam", planet: msg.planet, duration: 550 });
        const raidLog = msg.action.raid ? ` <span class="tag-raid">[targeting raid on ${msg.action.raid.target}]</span>` : "";
        this.addLog(
          `<span class="tag-ok">${msg.planet}</span> replies (${msg.latencyMs}ms): "${escapeHtml(msg.action.battleCry)}"${raidLog}`
        );
        break;
      }
      case "specialist_error": {
        const ship = this.ships.get(msg.planet);
        if (ship) ship.thinking = false;
        this.addLog(`<span class="tag-bad">${msg.planet}</span> comm failure — fell back to dormant action`);
        break;
      }
      case "epoch_resolved": {
        for (const [planet, r] of Object.entries(msg.results)) {
          this.applyResolution(planet, r);
        }
        for (const raid of msg.raids || []) this.applyRaid(raid);
        this.renderLeaderboard(msg.leaderboard);
        this.updateDominion(msg.dominion);
        if (msg.panspermia) {
          this.addEffect({
            type: "panspermia_arc",
            from: msg.panspermia.source,
            to: msg.panspermia.destination,
            duration: 900,
          });
          this.addLog(
            `<span class="tag-forecast">☄ PANSPERMIA</span> fragment from ${msg.panspermia.source} lands on ${msg.panspermia.destination}${msg.panspermia.revived ? " — REVIVAL!" : ""}`
          );
        }
        break;
      }
      case "engine_error": {
        this.addLog(`<span class="tag-bad">ENGINE ERROR</span> ${escapeHtml(msg.message)}`);
        break;
      }
    }
  }

  applyRaid(raid) {
    const attacker = this.ships.get(raid.attacker);
    const defender = this.ships.get(raid.defender);
    this.addEffect({ type: "raid_beam", from: raid.attacker, to: raid.defender, duration: 650 });
    if (raid.success && raid.stolen > 0) {
      if (attacker) {
        attacker.flash = { color: "#ff9d3b", until: performance.now() + 550 };
        this.setLabel(attacker, `+${Math.round(raid.stolen)} POP RAID!`, "#ff9d3b", 3500);
      }
      if (defender) {
        defender.flash = { color: "#ff3b4a", until: performance.now() + 550 };
        this.setLabel(defender, `-${Math.round(raid.stolen)} POP RAIDED`, "#ff3b4a", 3500);
      }
      this.triggerShake(2.5, 220);
      this.addLog(
        `<span class="tag-raid">⚔ RAID</span> ${raid.attacker} strikes ${raid.defender} — steals ${Math.round(raid.stolen)} POP`
      );
    } else {
      this.addLog(`<span class="tag-raid">⚔ RAID</span> ${raid.attacker} attacks ${raid.defender} — repelled, AP wasted`);
    }
  }

  applyResolution(planet, r) {
    const ship = this.ships.get(planet);
    if (!ship) return;
    const now = performance.now();
    ship.pop = r.pop;
    ship.maxPopEver = Math.max(ship.maxPopEver, r.pop);
    ship.traits = r.traits;
    ship.bottleneckActive = r.bottleneckActive;

    if (r.extinct) {
      this.addEffect({ type: "annihilate_beam", planet, duration: 1400 });
      this.triggerShake(9, 700);
      ship.extinct = true;
      this.addLog(`<span class="tag-bad">☠ ${planet.toUpperCase()} ANNIHILATED</span> — POP hit zero, benched to Fossil Record`);
      return;
    }

    if (r.outcome >= 0) {
      ship.flash = { color: "#3bff9e", until: now + 500 };
      if (r.reinforced) {
        this.setLabel(ship, `+1 ${r.defendingTrait}`, "#3bff9e", 2600);
      }
    } else {
      ship.flash = { color: "#ff3b4a", until: now + 500 };
    }
    if (r.bottleneckTriggered) {
      this.addLog(`<span class="tag-bad">⚠ ${planet}</span> bottleneck — population crashed below 250`);
    }
    this.addLog(
      `<span class="${r.outcome >= 0 ? "tag-ok" : "tag-bad"}">${planet}</span> ${r.hazardType} (${r.severity}) → outcome ${r.outcome >= 0 ? "+" : ""}${r.outcome}, POP ${r.pop}`
    );
  }

  renderLeaderboard(rows) {
    this.leaderboardEl.innerHTML = "";
    const maxCai = Math.max(0.01, ...rows.map((r) => r.cai));
    rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      tr.className = (r.extinct ? "extinct " : "") + (i === 0 ? "rank-1" : "");
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td class="planet-name">${r.planet}</td>
        <td><span class="cai-bar-track"><span class="cai-bar-fill" style="width:${(r.cai / maxCai) * 100}%"></span></span></td>
        <td>${r.cai.toFixed(2)}</td>
        <td class="${r.contestedNiche ? "contested" : ""}">${r.contestedNiche ? "⚔" : ""}</td>
      `;
      this.leaderboardEl.appendChild(tr);
    });
  }

  updateSimStateButtons(speed) {
    document.getElementById("btn-start").disabled = this.running;
    document.getElementById("btn-stop").disabled = !this.running;
    document.getElementById("btn-step").disabled = this.running;
    if (speed) document.getElementById("btn-speed").textContent = `⏩ SPEED ${speed}`;
  }

  // ---- render loop ----
  draw(now) {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.layoutPositions();

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    if (now < this.shake.until) {
      const decay = (this.shake.until - now) / 700;
      const mag = this.shake.mag * Math.max(0, decay);
      ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
    }

    this.drawStarfield(ctx, w, h, now);
    this.updateComets(w, h, now);
    for (const c of this.comets) this.drawComet(ctx, c);

    this.drawGruShip(ctx, now);

    this.maybeAmbientChatter(now);

    for (const name of PLANET_ORDER) {
      this.drawShip(ctx, this.ships.get(name), this.posOf(name), now);
    }

    this.effects = this.effects.filter((e) => now - e.startedAt < e.duration);
    for (const e of this.effects) this.drawEffect(ctx, e, now);

    ctx.restore();
  }

  drawStarfield(ctx, w, h, now) {
    // background is the nebula image (#bg-image, behind the canvas) — this layer
    // is just a sparse twinkling foreground for parallax depth, canvas stays transparent.
    for (const s of this.stars) {
      const y = ((s.y + now * 0.00002 * s.speed) % 1) * h;
      const x = s.x * w;
      const alpha = 0.25 + 0.55 * Math.abs(Math.sin(now * 0.001 * s.speed + s.tw));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#f2f0ff";
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  updateComets(w, h, now) {
    if (now > this.nextCometAt) {
      this.nextCometAt = now + 2500 + Math.random() * 4000;
      const fromLeft = Math.random() < 0.5;
      this.comets.push({
        x: fromLeft ? -20 : w + 20,
        y: Math.random() * h * 0.6,
        vx: (fromLeft ? 1 : -1) * (220 + Math.random() * 180),
        vy: 40 + Math.random() * 60,
        bornAt: now,
        len: 60 + Math.random() * 60,
      });
    }
    const dt = 0.016;
    for (const c of this.comets) {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
    }
    this.comets = this.comets.filter((c) => c.x > -100 && c.x < w + 100 && c.y < h + 100);
  }

  drawComet(ctx, c) {
    const ang = Math.atan2(c.vy, c.vx);
    const tailX = c.x - Math.cos(ang) * c.len;
    const tailY = c.y - Math.sin(ang) * c.len;
    const grad = ctx.createLinearGradient(c.x, c.y, tailX, tailY);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(c.x, c.y, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  maybeAmbientChatter(now) {
    if (now < this.nextChatterAt) return;
    this.nextChatterAt = now + 5000 + Math.random() * 6000;
    const alive = PLANET_ORDER.map((n) => this.ships.get(n)).filter((s) => s && !s.extinct && !s.label);
    if (!alive.length) return;
    const ship = alive[Math.floor(Math.random() * alive.length)];
    this.setLabel(ship, CHATTER_LINES[Math.floor(Math.random() * CHATTER_LINES.length)], "#8fd9ff", 2400);
  }

  drawGruShip(ctx, now) {
    const { x: gx, y: gy, w: gw, h: gh } = this.gruDraw;
    const cx = gx + gw / 2;
    const feetY = gy + gh;
    const firing = now < this.gruFireUntil;
    const pulse = firing ? 1 : 0.4 + 0.3 * Math.sin(now * 0.004);

    // hover platform beneath his feet — pulses, flares hard when he annihilates a target
    ctx.save();
    const platGrad = ctx.createRadialGradient(cx, feetY, 4, cx, feetY, gw * 0.9);
    platGrad.addColorStop(0, `rgba(160,110,220,${0.45 + pulse * 0.4})`);
    platGrad.addColorStop(1, "rgba(160,110,220,0)");
    ctx.beginPath();
    ctx.ellipse(cx, feetY + 4, gw * 0.72, 9, 0, 0, Math.PI * 2);
    ctx.fillStyle = platGrad;
    ctx.fill();
    ctx.restore();

    if (this.gruImgLoaded) {
      ctx.drawImage(this.gruImg, gx, gy, gw, gh);
    } else {
      ctx.fillStyle = "rgba(120,110,150,0.35)";
      ctx.fillRect(gx, gy, gw, gh);
    }

    // muzzle glow at his raygun when the annihilation beam fires
    if (firing) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.gruShipPos.x, this.gruShipPos.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,140,90,0.9)";
      ctx.shadowColor = "#ff7050";
      ctx.shadowBlur = 22;
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.font = "11px monospace";
    ctx.fillStyle = "#c9b6ff";
    ctx.textAlign = "center";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 4;
    ctx.fillText("IMPERATOR GRU", cx, feetY + 20);
    ctx.restore();
  }

  drawShip(ctx, ship, pos, now) {
    if (!pos) return;
    const { x, y } = pos;
    const scale = ship.extinct ? 0.7 : 1;
    const color = PLANET_COLOR[ship.name] || "#ffd400";
    const twoEyes = hashPlanet(ship.name) % 2 === 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = ship.extinct ? 0.28 : 1;

    // idle bob
    const bob = Math.sin(now * 0.0015 + x) * 3;
    ctx.translate(0, bob);
    ctx.scale(scale, scale);

    // thinking pulse ring
    if (ship.thinking) {
      const t = (now % 900) / 900;
      ctx.beginPath();
      ctx.arc(0, 0, 32 + t * 16, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(201,182,255,${1 - t})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // flash (damage/heal/raid)
    if (ship.flash && now < ship.flash.until) {
      const t = 1 - (ship.flash.until - now) / 550;
      ctx.beginPath();
      ctx.arc(0, 0, 26 + easeOut(t) * 12, 0, Math.PI * 2);
      ctx.strokeStyle = ship.flash.color;
      ctx.globalAlpha *= 1 - t;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = ship.extinct ? 0.28 : 1;
    }

    drawMinion(ctx, color, ship.extinct, twoEyes, now);

    // pop bar
    const popFrac = clamp01(ship.pop / Math.max(1000, ship.maxPopEver));
    ctx.globalAlpha = ship.extinct ? 0.28 : 1;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(-22, 32, 44, 5);
    ctx.fillStyle = ship.bottleneckActive ? "#ff3b4a" : "#3bff9e";
    ctx.fillRect(-22, 32, 44 * popFrac, 5);

    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#f0eeff";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 3;
    ctx.fillText(ship.name, 0, 50);
    ctx.shadowBlur = 0;
    if (ship.contestedNiche) {
      ctx.fillStyle = "#ff3b4a";
      ctx.fillText("⚔ contested", 0, 63);
    }

    // hazard forecast icon (fog of war — type only)
    if (ship.hazardForecast && !ship.extinct) {
      ctx.font = "9px monospace";
      ctx.fillStyle = "#d8d4ff";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 3;
      ctx.fillText(`⚠ ${ship.hazardForecast.hazardType}`, 0, -42);
      ctx.shadowBlur = 0;
    }

    ctx.restore();

    // floating label (order / battle cry / raid outcome) — chip background for legibility
    if (ship.label && now < ship.label.until) {
      const t = 1 - (ship.label.until - now) / ship.label.duration;
      ctx.save();
      ctx.globalAlpha = 1 - Math.max(0, t - 0.75) / 0.25;
      ctx.font = "13px monospace";
      ctx.textAlign = "center";
      drawLabelWithChip(ctx, ship.label.text, x, y + bob - 48 - t * 10, ship.label.color);
      ctx.restore();
    }
  }

  drawEffect(ctx, e, now) {
    const t = clamp01((now - e.startedAt) / e.duration);
    if (e.type === "dispatch_beam" || e.type === "response_beam") {
      const p = this.posOf(e.planet);
      if (!p) return;
      const from = e.type === "dispatch_beam" ? this.gruShipPos : p;
      const to = e.type === "dispatch_beam" ? p : this.gruShipPos;
      const color = e.type === "dispatch_beam" ? "180,150,255" : "255,212,0";
      const head = easeOut(t);
      const x = lerp(from.x, to.x, head);
      const y = lerp(from.y, to.y, head);
      ctx.save();
      ctx.strokeStyle = `rgba(${color},${0.8 * (1 - t)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = `rgba(${color},0.9)`;
      ctx.shadowColor = `rgba(${color},1)`;
      ctx.shadowBlur = 8;
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (e.type === "raid_beam") {
      const from = this.posOf(e.from);
      const to = this.posOf(e.to);
      if (!from || !to) return;
      const head = easeOut(Math.min(1, t * 1.6));
      const hx = lerp(from.x, to.x, head);
      const hy = lerp(from.y, to.y, head);
      ctx.save();
      ctx.strokeStyle = `rgba(255,120,50,${0.9 * (1 - t)})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = "#ff7832";
      ctx.shadowBlur = 10;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.restore();
    } else if (e.type === "annihilate_beam") {
      const p = this.posOf(e.planet);
      if (!p) return;
      this.gruFireUntil = Math.max(this.gruFireUntil, e.startedAt + e.duration);
      const beamOn = t > 0.15 && t < 0.85;
      ctx.save();
      if (beamOn) {
        const w = 7 + Math.sin(now * 0.05) * 3;
        const grad = ctx.createLinearGradient(this.gruShipPos.x, this.gruShipPos.y, p.x, p.y);
        grad.addColorStop(0, "rgba(255,110,80,0.95)");
        grad.addColorStop(1, "rgba(255,255,255,0.9)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = w;
        ctx.shadowColor = "#ff7050";
        ctx.shadowBlur = 24;
        ctx.beginPath();
        ctx.moveTo(this.gruShipPos.x, this.gruShipPos.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      if (t > 0.5) {
        const et = clamp01((t - 0.5) / 0.5);
        ctx.globalAlpha = 1 - et;
        for (let i = 0; i < 14; i++) {
          const ang = (i / 14) * Math.PI * 2;
          const dist = et * 34;
          ctx.beginPath();
          ctx.fillStyle = i % 2 ? "#ff9d3b" : "#ffe066";
          ctx.arc(p.x + Math.cos(ang) * dist, p.y + Math.sin(ang) * dist, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    } else if (e.type === "panspermia_arc") {
      const from = this.posOf(e.from);
      const to = this.posOf(e.to);
      if (!from || !to) return;
      const midX = (from.x + to.x) / 2;
      const midY = Math.min(from.y, to.y) - 60;
      const bt = easeOut(t);
      const x = bezier(from.x, midX, to.x, bt);
      const y = bezier(from.y, midY, to.y, bt);
      ctx.save();
      ctx.fillStyle = "rgba(255,210,120,0.9)";
      ctx.shadowColor = "#ffcf7d";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function bezier(a, b, c, t) {
  return (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
}

function hashPlanet(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function drawMinion(ctx, color, dim, twoEyes, now) {
  const bodyColor = dim ? "#555" : color;

  // X-wing cannon struts + wings, behind the body
  ctx.strokeStyle = dim ? "#555" : "#8fa6c9";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-4, 6);
  ctx.lineTo(-30, -12);
  ctx.moveTo(-4, 6);
  ctx.lineTo(-30, 14);
  ctx.moveTo(4, 6);
  ctx.lineTo(30, -12);
  ctx.moveTo(4, 6);
  ctx.lineTo(30, 14);
  ctx.stroke();
  // wingtip cannons
  ctx.fillStyle = dim ? "#444" : "#5a6b85";
  [-30, 30].forEach((wx) => {
    ctx.fillRect(wx - 3, -14, 6, 4);
    ctx.fillRect(wx - 3, 12, 6, 4);
  });

  // Minion body — rounded capsule
  ctx.fillStyle = bodyColor;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-13, -6);
  ctx.quadraticCurveTo(-14, -24, 0, -24);
  ctx.quadraticCurveTo(14, -24, 13, -6);
  ctx.quadraticCurveTo(15, 14, 8, 20);
  ctx.quadraticCurveTo(0, 24, -8, 20);
  ctx.quadraticCurveTo(-15, 14, -13, -6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // denim overalls (lower body)
  ctx.fillStyle = dim ? "#334" : "#2f4f8f";
  ctx.beginPath();
  ctx.moveTo(-12, 6);
  ctx.lineTo(12, 6);
  ctx.lineTo(9, 20);
  ctx.quadraticCurveTo(0, 25, -9, 20);
  ctx.closePath();
  ctx.fill();
  // overalls pocket + straps
  ctx.fillStyle = dim ? "#445" : "#3f63af";
  ctx.fillRect(-3, 8, 6, 6);
  ctx.strokeStyle = dim ? "#334" : "#2f4f8f";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-8, -4);
  ctx.lineTo(-6, 8);
  ctx.moveTo(8, -4);
  ctx.lineTo(6, 8);
  ctx.stroke();

  // goggle strap
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-14, -13);
  ctx.lineTo(14, -13);
  ctx.stroke();

  // eyes
  const eyeY = -13;
  const eyeSpots = twoEyes ? [-6, 6] : [0];
  const eyeR = twoEyes ? 5.5 : 8;
  for (const ex of eyeSpots) {
    ctx.beginPath();
    ctx.fillStyle = "#f4f4f0";
    ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    const blink = Math.sin(now * 0.0007 + ex) > 0.985;
    if (!blink) {
      ctx.beginPath();
      ctx.fillStyle = "#2b2b2b";
      ctx.arc(ex + 0.6, eyeY, eyeR * 0.42, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = "#2b2b2b";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(ex - eyeR * 0.4, eyeY);
      ctx.lineTo(ex + eyeR * 0.4, eyeY);
      ctx.stroke();
    }
  }

  // hair tuft(s)
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-2, -24);
  ctx.quadraticCurveTo(-4, -32, -1, -30);
  ctx.moveTo(2, -24);
  ctx.quadraticCurveTo(4, -33, 1, -30);
  ctx.stroke();

  // stubby arms with glove ends
  ctx.strokeStyle = bodyColor;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-13, 2);
  ctx.lineTo(-19, 10);
  ctx.moveTo(13, 2);
  ctx.lineTo(19, 10);
  ctx.stroke();
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.arc(-19, 10, 3, 0, Math.PI * 2);
  ctx.arc(19, 10, 3, 0, Math.PI * 2);
  ctx.fill();

  // engine glow
  ctx.beginPath();
  ctx.fillStyle = dim ? "rgba(255,100,100,0.3)" : "rgba(120,180,255,0.85)";
  ctx.shadowColor = dim ? "transparent" : "#7db8ff";
  ctx.shadowBlur = dim ? 0 : 6;
  ctx.arc(0, 22, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawLabelWithChip(ctx, text, x, y, color) {
  const lines = wrapLines(ctx, String(text), 150);
  const lineHeight = 15;
  const totalH = lines.length * lineHeight;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const chipW = widest + 16;
  const chipH = totalH + 8;
  const topY = y - totalH;

  roundRectPath(ctx, x - chipW / 2, topY - 6, chipW, chipH, 6);
  ctx.fillStyle = "rgba(6,6,16,0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = color;
  lines.forEach((l, i) => ctx.fillText(l, x, topY + (i + 1) * lineHeight - 3));
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(" ");
  let line = "";
  const lines = [];
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export { PLANET_ORDER };
