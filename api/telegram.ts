import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { getConfig } from "../src/config.js";
import { createAnswerGenerator } from "../src/openai.js";
import { createTelegramSender, processUpdate, type TelegramUpdate } from "../src/telegram.js";

function secretMatches(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(req: IncomingMessage): Promise<TelegramUpdate> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as TelegramUpdate;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" }).end("Method Not Allowed");
    return;
  }
  try {
    const config = getConfig();
    const header = req.headers["x-telegram-bot-api-secret-token"];
    const received = Array.isArray(header) ? header[0] : header;
    if (!secretMatches(received, config.webhookSecret)) {
      res.writeHead(401).end("Unauthorized");
      return;
    }
    const update = await readJson(req);
    await processUpdate(update, {
      answer: createAnswerGenerator(config.openaiApiKey, config.openaiModel),
      send: createTelegramSender(config.telegramBotToken),
    });
    res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
  } catch (error) {
    console.error("Webhook update failed", error);
    res.writeHead(400, { "content-type": "application/json" }).end('{"ok":false}');
  }
}
