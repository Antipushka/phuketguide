import assert from "node:assert/strict";
import test from "node:test";
import { getConfig } from "../src/config.js";
import { HELP_TEXT, START_TEXT, processUpdate, splitMessage } from "../src/telegram.js";

test("configuration validates required secrets and defaults the model", () => {
  assert.throws(() => getConfig({}));
  assert.equal(getConfig({ TELEGRAM_BOT_TOKEN: "t", OPENAI_API_KEY: "k", TELEGRAM_WEBHOOK_SECRET: "s" }).openaiModel, "gpt-4.1-mini");
});

test("start and help commands return static messages", async () => {
  const sent: string[] = [];
  const deps = { answer: async () => "unused", send: async (_id: number, text: string) => { sent.push(text); } };
  await processUpdate({ message: { chat: { id: 1 }, text: "/start" } }, deps);
  await processUpdate({ message: { chat: { id: 1 }, text: "/help@phuketguide_ai_bot" } }, deps);
  assert.deepEqual(sent, [START_TEXT, HELP_TEXT]);
});

test("a text message is sent to AI and the same chat", async () => {
  let question = "";
  let recipient = 0;
  await processUpdate({ message: { chat: { id: 42 }, text: "  Где закат? " } }, {
    answer: async (text) => { question = text; return "На мысе Промтеп"; },
    send: async (id, text) => { recipient = id; assert.equal(text, "На мысе Промтеп"); },
  });
  assert.equal(question, "Где закат?");
  assert.equal(recipient, 42);
});

test("OpenAI errors produce a friendly message", async () => {
  const sent: string[] = [];
  await processUpdate({ message: { chat: { id: 1 }, text: "question" } }, {
    answer: async () => { throw new Error("provider unavailable"); },
    send: async (_id, text) => { sent.push(text); },
    log: { error() {} },
  });
  assert.match(sent[0], /попробуйте ещё раз/);
});

test("unsupported updates are ignored", async () => {
  let called = false;
  await processUpdate({ update_id: 1 }, { answer: async () => "", send: async () => { called = true; } });
  await processUpdate({ message: { chat: { id: 1 } } }, { answer: async () => "", send: async () => { called = true; } });
  assert.equal(called, false);
});

test("long Telegram messages are split within the limit", () => {
  const parts = splitMessage("слово ".repeat(1500), 100);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 100));
  assert.equal(parts.join(" ").replace(/\s+/g, " ").trim(), "слово ".repeat(1500).trim());
});
