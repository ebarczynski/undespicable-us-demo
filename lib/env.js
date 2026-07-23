import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** Tiny .env loader — mirrors the parsing rules in setup-test.ipynb (no dotenv dependency). */
export function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      const k = key.trim().replace(/^export\s+/, "");
      let v = rest.join("=").trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key.startsWith("sk-ant-")) {
    throw new Error(
      "ANTHROPIC_API_KEY missing or malformed in .env — paste a key starting with sk-ant- and retry."
    );
  }
  return key;
}

export const ROOT_DIR = ROOT;
