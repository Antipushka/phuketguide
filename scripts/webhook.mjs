import { readFileSync, existsSync } from "node:fs";

for (const file of [".env", ".env.local"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const action = process.argv[2];
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing. Add it to .env.local or the command environment.");

const method = action === "set" ? "setWebhook" : action === "info" ? "getWebhookInfo" : undefined;
if (!method) throw new Error("Use npm run webhook:set or npm run webhook:info");

let body;
if (action === "set") {
  const baseUrl = (process.env.WEBHOOK_URL || process.argv[3] || "").replace(/\/$/, "");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!baseUrl) throw new Error("WEBHOOK_URL is missing (example: WEBHOOK_URL=https://project.vercel.app npm run webhook:set)");
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is missing.");
  body = { url: `${baseUrl}/api/telegram`, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: false };
}

const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body ?? {}),
  signal: AbortSignal.timeout(10_000),
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(`Telegram rejected the request: ${result.description ?? response.status}`);
console.log(JSON.stringify(result, null, 2));
