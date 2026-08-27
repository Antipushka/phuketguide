import assert from "node:assert/strict";
import test from "node:test";
import type { Response } from "openai/resources/responses/responses";
import { getConfig } from "../src/config.js";
import { generateAnswer, type ResponsesClient } from "../src/openai.js";
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
  assert.match(sent[0], /try again/);
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

function response(output: Response["output"], outputText: string): Response {
  return { output, output_text: outputText } as Response;
}

function clientWith(value: Response | Error, inspect?: (params: Record<string, unknown>) => void): ResponsesClient {
  return { responses: { async create(params) { inspect?.(params); if (value instanceof Error) throw value; return value; } } };
}

test("a stable request allows automatic selection without using web search", async () => {
  const result = await generateAnswer(clientWith(response([], "Bang Tao спокойнее ночью."), (params) => {
    assert.equal(params.tool_choice, "auto");
    assert.deepEqual(params.tools, [{ type: "web_search" }]);
  }), "gpt-test", "Чем отличаются районы?");
  assert.equal(result.usedWebSearch, false);
});

test("a live request detects web search and preserves citation URLs", async () => {
  const output = [
    { type: "web_search_call", id: "search_1", status: "completed", action: { type: "search", query: "Phuket events" } },
    { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Сегодня есть маркет.", logprobs: [], annotations: [{ type: "url_citation", start_index: 0, end_index: 7, title: "Official", url: "https://example.com/event" }] }] },
  ] as unknown as Response["output"];
  const result = await generateAnswer(clientWith(response(output, "Сегодня есть маркет.")), "gpt-test", "Что сегодня?");
  assert.equal(result.usedWebSearch, true);
  assert.deepEqual(result.sources, ["https://example.com/event"]);
});

test("web search errors are propagated for the Telegram fallback", async () => {
  await assert.rejects(() => generateAnswer(clientWith(new Error("search failed")), "gpt-test", "Что открыто?"), /search failed/);
});

test("timeouts produce a localized Telegram fallback", async () => {
  const sent: string[] = [];
  const timeout = Object.assign(new Error("timed out"), { name: "APIConnectionTimeoutError" });
  await processUpdate({ message: { chat: { id: 1 }, text: "Что открыто сегодня?" } }, {
    answer: async () => { throw timeout; }, send: async (_id, text) => { sent.push(text); }, log: { info() {}, error() {} },
  });
  assert.match(sent[0], /не удалось быстро проверить/);
});

test("Telegram fallback delivery errors do not escape the webhook", async () => {
  let attempts = 0;
  await processUpdate({ message: { chat: { id: 1 }, text: "Current events?" } }, {
    answer: async () => { throw new Error("OpenAI unavailable"); },
    send: async () => { attempts++; throw new Error("Telegram unavailable"); }, log: { info() {}, error() {} },
  });
  assert.equal(attempts, 1);
});

test("a long live-search answer remains compatible with Telegram chunking", () => {
  const chunks = splitMessage("вариант ".repeat(1_500));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 4_000));
});
