// Asteroids-style playable diversion: steer a Minion, dodge Gru's telegraphed
// wrath-ray sweeps, shoot asteroid debris for score.
const TAU = Math.PI * 2;
const GRU_ASPECT = 666 / 1524; // same source cutout as sim.js's Gru portrait

function wrap(v, max) {
  if (v < 0) return v + max;
  if (v > max) return v - max;
  return v;
}

export class FunMode {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.active = false;
    this.gruImg = new Image();
    this.gruImgLoaded = false;
    this.gruImg.onload = () => {
      this.gruImgLoaded = true;
    };
    this.gruImg.src = "assets/gru.png";
    this.reset();
  }

  reset() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.ship = { x: w / 2, y: h / 2, vx: 0, vy: 0, angle: -Math.PI / 2, invuln: 2 };
    this.bullets = [];
    this.asteroids = [];
    this.particles = [];
    this.score = 0;
    this.lives = 3;
    this.gameOver = false;
    this.keys = new Set();
    this.shotCooldown = 0;
    this.rayWarnAt = performance.now() + 2200;
    this.ray = null; // { angle, phase, phaseUntil }
    this.gruShipPos = { x: 60, y: 60 };
    for (let i = 0; i < 5; i++) this.spawnAsteroid();
    this.setHud();
  }

  activate() {
    this.active = true;
    this.reset();
    document.getElementById("funmode-overlay").classList.remove("hidden");
    document.getElementById("funmode-gameover").classList.add("hidden");
  }

  deactivate() {
    this.active = false;
    document.getElementById("funmode-overlay").classList.add("hidden");
  }

  onKeyDown(code) {
    this.keys.add(code);
    if (this.gameOver && code === "Space") this.reset();
  }
  onKeyUp(code) {
    this.keys.delete(code);
  }

  spawnAsteroid(x, y, radius) {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const r = radius || 22 + Math.random() * 20;
    let ax = x, ay = y;
    if (ax === undefined) {
      const edge = Math.floor(Math.random() * 4);
      ax = edge === 0 ? 0 : edge === 1 ? w : Math.random() * w;
      ay = edge === 2 ? 0 : edge === 3 ? h : Math.random() * h;
    }
    const angle = Math.random() * TAU;
    const speed = 20 + Math.random() * 40;
    const verts = 8 + Math.floor(Math.random() * 4);
    const jag = Array.from({ length: verts }, () => 0.7 + Math.random() * 0.5);
    this.asteroids.push({
      x: ax, y: ay,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      r, spin: (Math.random() - 0.5) * 1.5, rot: 0, jag,
    });
  }

  setHud() {
    document.getElementById("fm-score").textContent = Math.floor(this.score);
    document.getElementById("fm-lives").textContent = this.lives;
  }

  update(dt, now) {
    if (this.gameOver) return;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const s = this.ship;

    const left = this.keys.has("ArrowLeft") || this.keys.has("KeyA");
    const right = this.keys.has("ArrowRight") || this.keys.has("KeyD");
    const thrust = this.keys.has("ArrowUp") || this.keys.has("KeyW");
    const fire = this.keys.has("Space");

    if (left) s.angle -= 3.2 * dt;
    if (right) s.angle += 3.2 * dt;
    if (thrust) {
      s.vx += Math.cos(s.angle) * 140 * dt;
      s.vy += Math.sin(s.angle) * 140 * dt;
    }
    s.vx *= 0.992;
    s.vy *= 0.992;
    s.x = wrap(s.x + s.vx * dt, w);
    s.y = wrap(s.y + s.vy * dt, h);
    if (s.invuln > 0) s.invuln -= dt;

    this.shotCooldown -= dt;
    if (fire && this.shotCooldown <= 0) {
      this.shotCooldown = 0.18;
      this.bullets.push({
        x: s.x + Math.cos(s.angle) * 14,
        y: s.y + Math.sin(s.angle) * 14,
        vx: Math.cos(s.angle) * 340 + s.vx,
        vy: Math.sin(s.angle) * 340 + s.vy,
        ttl: 1.1,
      });
    }

    for (const b of this.bullets) {
      b.x = wrap(b.x + b.vx * dt, w);
      b.y = wrap(b.y + b.vy * dt, h);
      b.ttl -= dt;
    }
    this.bullets = this.bullets.filter((b) => b.ttl > 0);

    for (const a of this.asteroids) {
      a.x = wrap(a.x + a.vx * dt, w);
      a.y = wrap(a.y + a.vy * dt, h);
      a.rot += a.spin * dt;
    }

    // bullet vs asteroid
    const survivors = [];
    for (const a of this.asteroids) {
      let hit = null;
      for (const b of this.bullets) {
        if (Math.hypot(a.x - b.x, a.y - b.y) < a.r) {
          hit = b;
          break;
        }
      }
      if (hit) {
        hit.ttl = 0;
        this.score += a.r > 30 ? 20 : a.r > 18 ? 50 : 100;
        this.burst(a.x, a.y);
        if (a.r > 16) {
          for (let i = 0; i < 2; i++) this.spawnAsteroid(a.x, a.y, a.r * 0.55);
        }
      } else {
        survivors.push(a);
      }
    }
    this.asteroids = survivors;
    if (this.asteroids.length < 4) this.spawnAsteroid();

    // ship vs asteroid
    if (s.invuln <= 0) {
      for (const a of this.asteroids) {
        if (Math.hypot(a.x - s.x, a.y - s.y) < a.r + 8) {
          this.hitShip();
          break;
        }
      }
    }

    this.updateDeathRay(now, dt);
    this.particles = this.particles.filter((p) => (p.ttl -= dt) > 0);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    this.score += dt * 1; // survival bonus
    this.setHud();
  }

  updateDeathRay(now, dt) {
    if (!this.ray && now > this.rayWarnAt) {
      this.ray = { angle: Math.random() * TAU, phase: "warn", phaseUntil: now + 900 };
    }
    if (!this.ray) return;
    if (now > this.ray.phaseUntil) {
      if (this.ray.phase === "warn") {
        this.ray.phase = "fire";
        this.ray.phaseUntil = now + 450;
      } else if (this.ray.phase === "fire") {
        this.ray = null;
        this.rayWarnAt = now + 3200 + Math.random() * 1800;
        return;
      }
    }
    if (this.ray && this.ray.phase === "fire" && this.ship.invuln <= 0) {
      if (this.distToRay(this.ship.x, this.ship.y, this.ray.angle) < 16) this.hitShip();
    }
  }

  distToRay(px, py, angle) {
    const dx = this.gruShipPos.x, dy = this.gruShipPos.y;
    const dirx = Math.cos(angle), diry = Math.sin(angle);
    const t = (px - dx) * dirx + (py - dy) * diry;
    if (t < 0) return Infinity;
    const cx = dx + dirx * t, cy = dy + diry * t;
    return Math.hypot(px - cx, py - cy);
  }

  hitShip() {
    this.lives -= 1;
    this.burst(this.ship.x, this.ship.y);
    this.ship.invuln = 1.6;
    this.ship.x = this.canvas.clientWidth / 2;
    this.ship.y = this.canvas.clientHeight / 2;
    this.ship.vx = 0;
    this.ship.vy = 0;
    if (this.lives <= 0) {
      this.gameOver = true;
      document.getElementById("fm-final-score").textContent = Math.floor(this.score);
      document.getElementById("funmode-gameover").classList.remove("hidden");
    }
    this.setHud();
  }

  burst(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU;
      const sp = 40 + Math.random() * 90;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ttl: 0.5 + Math.random() * 0.4 });
    }
  }

  draw(now) {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    // #bg-image (the nebula art) shows through — just darken it a touch for gameplay contrast.
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(4,4,16,0.4)";
    ctx.fillRect(0, 0, w, h);

    // subtle starfield
    ctx.fillStyle = "#e8e4ff";
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 60; i++) {
      const x = (i * 97) % w;
      const y = (i * 53 + Math.floor(now / 30)) % h;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;

    this.drawGruShip(ctx, now);
    this.drawRay(ctx, now);

    ctx.strokeStyle = "#8fd9ff";
    ctx.lineWidth = 1.4;
    for (const a of this.asteroids) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.beginPath();
      a.jag.forEach((j, i) => {
        const ang = (i / a.jag.length) * TAU;
        const rr = a.r * j;
        const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = "#ffe066";
    for (const b of this.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, TAU);
      ctx.fill();
    }

    for (const p of this.particles) {
      ctx.globalAlpha = clamp01(p.ttl / 0.6);
      ctx.fillStyle = "#ffcf7d";
      ctx.fillRect(p.x, p.y, 2, 2);
    }
    ctx.globalAlpha = 1;

    this.drawShip(ctx, now);

    if (this.gameOver) {
      ctx.fillStyle = "rgba(4,4,10,0.35)";
      ctx.fillRect(0, 0, w, h);
    }
  }

  drawGruShip(ctx, now) {
    const { x, y } = this.gruShipPos;
    const h = 64;
    const w = h * GRU_ASPECT;
    const feetY = y + 32;
    const drawX = x - w / 2;
    const drawY = feetY - h;
    const pulse = this.ray ? 1 : 0.5 + 0.3 * Math.sin(now * 0.005);

    ctx.save();
    const platGrad = ctx.createRadialGradient(x, feetY, 2, x, feetY, w * 1.4);
    platGrad.addColorStop(0, `rgba(160,110,220,${0.4 + pulse * 0.4})`);
    platGrad.addColorStop(1, "rgba(160,110,220,0)");
    ctx.beginPath();
    ctx.ellipse(x, feetY + 2, w * 1.1, 5, 0, 0, TAU);
    ctx.fillStyle = platGrad;
    ctx.fill();
    ctx.restore();

    if (this.gruImgLoaded) {
      ctx.drawImage(this.gruImg, drawX, drawY, w, h);
    } else {
      ctx.fillStyle = "rgba(120,110,150,0.4)";
      ctx.fillRect(drawX, drawY, w, h);
    }

    ctx.save();
    ctx.font = "9px monospace";
    ctx.fillStyle = "#c9b6ff";
    ctx.textAlign = "center";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 3;
    ctx.fillText("GRU", x, feetY + 12);
    ctx.restore();
  }

  drawRay(ctx, now) {
    if (!this.ray) return;
    const { x, y } = this.gruShipPos;
    const len = Math.max(this.canvas.clientWidth, this.canvas.clientHeight) * 1.5;
    const ex = x + Math.cos(this.ray.angle) * len;
    const ey = y + Math.sin(this.ray.angle) * len;
    ctx.save();
    if (this.ray.phase === "warn") {
      ctx.strokeStyle = "rgba(255,59,74,0.55)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
    } else {
      const pulse = 10 + Math.sin(now * 0.08) * 4;
      ctx.strokeStyle = "rgba(255,90,90,0.9)";
      ctx.shadowColor = "#ff3b4a";
      ctx.shadowBlur = 24;
      ctx.lineWidth = pulse;
    }
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();
  }

  drawShip(ctx, now) {
    const s = this.ship;
    const blink = s.invuln > 0 && Math.floor(now / 100) % 2 === 0;
    if (blink) return;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle + Math.PI / 2);
    ctx.scale(0.75, 0.75);

    // wings + wingtip cannons
    ctx.strokeStyle = "#8fa6c9";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-4, 6); ctx.lineTo(-28, -10);
    ctx.moveTo(-4, 6); ctx.lineTo(-28, 14);
    ctx.moveTo(4, 6); ctx.lineTo(28, -10);
    ctx.moveTo(4, 6); ctx.lineTo(28, 14);
    ctx.stroke();

    // Minion capsule body
    ctx.fillStyle = "#ffd400";
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-11, -5);
    ctx.quadraticCurveTo(-12, -20, 0, -20);
    ctx.quadraticCurveTo(12, -20, 11, -5);
    ctx.quadraticCurveTo(13, 12, 6, 17);
    ctx.quadraticCurveTo(0, 20, -6, 17);
    ctx.quadraticCurveTo(-13, 12, -11, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // denim overalls
    ctx.fillStyle = "#2f4f8f";
    ctx.beginPath();
    ctx.moveTo(-10, 4);
    ctx.lineTo(10, 4);
    ctx.lineTo(7, 17);
    ctx.quadraticCurveTo(0, 21, -7, 17);
    ctx.closePath();
    ctx.fill();

    // goggle strap + eyes
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-12, -11);
    ctx.lineTo(12, -11);
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = "#f4f4f0";
    ctx.arc(0, -11, 7, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = "#2b2b2b";
    ctx.arc(0.6, -11, 3, 0, TAU);
    ctx.fill();

    if (this.keys.has("ArrowUp") || this.keys.has("KeyW")) {
      ctx.beginPath();
      ctx.fillStyle = "rgba(120,180,255,0.85)";
      ctx.moveTo(-4, 17);
      ctx.lineTo(4, 17);
      ctx.lineTo(0, 26 + Math.random() * 7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}
