import assert from "node:assert/strict";
import test from "node:test";
import type { Response } from "openai/resources/responses/responses";
import { getConfig } from "../src/config.js";
import { deduplicateParagraphs, generateAnswer, normalizeSourceUrl, type ResponsesClient } from "../src/openai.js";
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

test("a main OpenAI API failure produces the generic Telegram fallback", async () => {
  const sent: string[] = [];
  const answer = (question: string) => generateAnswer(clientWith(new Error("provider unavailable")), "gpt-test", question);
  await processUpdate({ message: { chat: { id: 1 }, text: "Что открыто?" } }, { answer, send: async (_id, text) => { sent.push(text); }, log: { error() {} } });
  assert.equal(sent[0], "Сейчас не получилось получить ответ. Попробуй ещё раз через минуту.");
});

test("a main OpenAI timeout produces the timeout fallback", async () => {
  const sent: string[] = [];
  const timeout = Object.assign(new Error("timed out"), { name: "APIConnectionTimeoutError" });
  const answer = (question: string) => generateAnswer(clientWith(timeout), "gpt-test", question);
  await processUpdate({ message: { chat: { id: 1 }, text: "Что открыто сегодня?" } }, { answer, send: async (_id, text) => { sent.push(text); }, log: { error() {} } });
  assert.match(sent[0], /не удалось быстро проверить/);
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

function clientWith(
  value: Response | Error,
  inspect?: (params: Record<string, unknown>) => void,
): ResponsesClient {
  return { responses: { async create(params) {
    inspect?.(params);
    if (value instanceof Error) throw value;
    return value;
  } } };
}

test("a stable query gets an answer through one automatic-tool request", async () => {
  let calls = 0;
  const result = await generateAnswer(clientWith(response([], "Bang Tao is quieter at night."), (params) => {
    calls++;
    assert.equal(params.tool_choice, "auto");
    assert.deepEqual(params.tools, [{ type: "web_search", external_web_access: true, search_context_size: "medium", user_location: { type: "approximate", city: "Phuket", region: "Phuket", country: "TH", timezone: "Asia/Bangkok" } }]);
    assert.equal("text" in params, false, "the answer request must not use a classifier JSON schema");
  }), "gpt-test", "Which area is best for families?");
  assert.equal(calls, 1);
  assert.equal(result.text, "Bang Tao is quieter at night.");
  assert.equal(result.usedWebSearch, false);
});

test("a current query may use web search and still returns an answer", async () => {
  const output = [
    { type: "web_search_call", id: "search_1", status: "completed", action: { type: "search", query: "Phuket events today" } },
    { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Сегодня есть маркет.", logprobs: [], annotations: [{ type: "url_citation", start_index: 0, end_index: 7, title: "Official", url: "https://example.com/event" }] }] },
  ] as unknown as Response["output"];
  const result = await generateAnswer(clientWith(response(output, "Сегодня есть маркет."), (params) => {
    assert.equal(params.tool_choice, "auto");
    assert.match(String(params.instructions), /Current Phuket local datetime:/);
  }), "gpt-test", "Что происходит сегодня?");
  assert.equal(result.usedWebSearch, true);
  assert.deepEqual(result.sources, ["https://example.com/event"]);
  assert.equal(result.text, "Сегодня есть маркет.");
});

test("web search without a URL citation does not suppress the answer", async () => {
  const output = [{ type: "web_search_call", id: "search_1", status: "completed", action: { type: "search" } }] as unknown as Response["output"];
  const result = await generateAnswer(clientWith(response(output, "Не удалось подтвердить часы, но район обычно оживлён вечером.")), "gpt-test", "Что открыто сейчас?");
  assert.equal(result.usedWebSearch, true);
  assert.deepEqual(result.sources, []);
  assert.match(result.text, /район обычно оживлён/);
});

test("no search results can produce a useful partial general answer", async () => {
  const output = [{ type: "web_search_call", id: "search_1", status: "completed", action: { type: "search", sources: [] } }] as unknown as Response["output"];
  const result = await generateAnswer(clientWith(response(output, "I couldn't confirm today's events. Old Town is generally a good area to check local venue boards.")), "gpt-test", "Events today?");
  assert.match(result.text, /Old Town/);
});

test("Russian and English messages use the same single answer pipeline", async () => {
  for (const [question, answer] of [["Куда сходить с детьми?", "Подойдёт аквариум."], ["Where can I go with kids?", "The aquarium is a good option."]]) {
    let calls = 0;
    const result = await generateAnswer(clientWith(response([], answer), (params) => {
      calls++;
      assert.match(String(params.instructions), /language of THIS user message is authoritative/i);
    }), "gpt-test", question);
    assert.equal(calls, 1);
    assert.equal(result.text, answer);
  }
});

test("duplicate and tracked source URLs collapse to one canonical source", async () => {
  const output = [
    { type: "web_search_call", id: "search_1", status: "completed", action: { type: "search" } },
    { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Открыто до 22:00.", logprobs: [], annotations: [
      { type: "url_citation", start_index: 0, end_index: 7, title: "Official", url: "https://example.com/hours?utm_source=openai" },
      { type: "url_citation", start_index: 0, end_index: 7, title: "Official", url: "https://example.com/hours" },
    ] }] },
  ] as unknown as Response["output"];
  const result = await generateAnswer(clientWith(response(output, "Открыто до 22:00.")), "gpt-test", "Во сколько сегодня закрывается?");
  assert.equal(result.sourceCount, 2);
  assert.deepEqual(result.sources, ["https://example.com/hours"]);
  assert.equal(normalizeSourceUrl("https://example.com/hours?utm_source=openai"), "https://example.com/hours");
});

test("identical paragraphs are emitted once even when citations differ", () => {
  const text = "Сейчас тепло. https://example.com/a\n\nСейчас тепло. https://example.com/a?utm_source=openai\n\nВозьми зонт.";
  assert.equal(deduplicateParagraphs(text), "Сейчас тепло. https://example.com/a\n\nВозьми зонт.");
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

import { filterOpenNow, getOpenStatus, getPhuketDateTime, isOpenToday, PHUKET_TIME_ZONE, phuketDateTimeContext, type WeeklyHours } from "../src/time.js";
import { removeHistoricalWeatherBlock, renderTelegramHtml } from "../src/rendering.js";

test("Phuket datetime is dynamically converted in Asia/Bangkok", () => {
  const local = getPhuketDateTime(new Date("2026-08-27T17:28:00Z"));
  assert.equal(PHUKET_TIME_ZONE, "Asia/Bangkok");
  assert.deepEqual([local.date, local.time, local.weekday], ["2026-08-28", "00:28", "Friday"]);
  assert.match(phuketDateTimeContext(new Date("2026-08-27T17:28:00Z")), /2026-08-28 00:28, Friday, Asia\/Bangkok \(UTC\+7\)/);
});

test("open-now honors midnight boundaries and previous-day overnight hours", () => {
  const friday = 5;
  assert.equal(getOpenStatus({ [friday]: [{ open: "07:30", close: "00:00" }] }, { time: "00:28", weekdayIndex: friday }), "CLOSED");
  assert.equal(getOpenStatus({ 4: [{ open: "18:00", close: "02:00" }] }, { time: "01:00", weekdayIndex: friday }), "OPEN");
  assert.equal(getOpenStatus(undefined, { time: "12:00", weekdayIndex: friday }), "UNKNOWN");
});

test("open today differs from open now", () => {
  const hours: WeeklyHours = { 5: [{ open: "07:30", close: "00:00" }] };
  assert.equal(isOpenToday(hours, 5), true);
  assert.equal(getOpenStatus(hours, { time: "00:28", weekdayIndex: 5 }), "CLOSED");
});

test("open-now filtering excludes CLOSED and UNKNOWN without padding", () => {
  const result = filterOpenNow([{ name: "A", status: "OPEN" as const }, { name: "B", status: "CLOSED" as const }, { name: "C", status: "UNKNOWN" as const }, { name: "D", status: "OPEN" as const }]);
  assert.deepEqual(result.map((place) => place.name), ["A", "D"]);
});

test("Telegram renderer emits HTML compact links and removes source dumps, tracking and duplicates", () => {
  const html = renderTelegramHtml("## **1. Place**\n[Подробнее](https://example.com/a?utm_source=openai)\n\n[Подробнее](https://example.com/a)\n\nSources:\n- snippet https://source.test");
  assert.match(html, /<b>1\. Place<\/b>/);
  assert.doesNotMatch(html, /\*\*|Sources:|utm_source|(^|>\s*)https:\/\/example\.com/m);
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.match(html, /href="https:\/\/example\.com\/a"/);
});

test("current weather cleanup does not append a historical block", () => {
  assert.equal(removeHistoricalWeatherBlock("Now: 29 °C.\n\nHistorical climate averages: 28 °C."), "Now: 29 °C.");
});

test("Telegram sender disables previews and uses HTML parse mode", async () => {
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => { body = JSON.parse(String(init?.body)); return new Response(null, { status: 200 }); };
  try { await (await import("../src/telegram.js")).createTelegramSender("token")(1, "<b>Hello</b>"); } finally { globalThis.fetch = original; }
  assert.equal(body.parse_mode, "HTML");
  assert.deepEqual(body.link_preview_options, { is_disabled: true });
});

test("open-now answer safety gate retains only explicitly verified venue blocks", async () => {
  const { filterOpenNowAnswer } = await import("../src/openai.js");
  const answer = filterOpenNowAnswer("Two verified places:\n\nA is open. [STATUS:OPEN]\n\nB is closed. [STATUS:CLOSED]\n\nC uncertain. [STATUS:UNKNOWN]\n\nD is open. [STATUS:OPEN]", "Could not verify.");
  assert.match(answer, /A is open/); assert.match(answer, /D is open/);
  assert.doesNotMatch(answer, /B is closed|C uncertain|STATUS/);
});
