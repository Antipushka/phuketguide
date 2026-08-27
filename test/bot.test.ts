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
  route: { freshness_sensitive: boolean; fallback: string } = { freshness_sensitive: false, fallback: "Fresh data unavailable." },
): ResponsesClient {
  return { responses: { async create(params) {
    if (!("tools" in params)) return response([], JSON.stringify(route));
    inspect?.(params);
    if (value instanceof Error) throw value;
    return value;
  } } };
}

test("a stable request allows automatic selection without using web search", async () => {
  const result = await generateAnswer(clientWith(response([], "Bang Tao спокойнее ночью."), (params) => {
    assert.equal(params.tool_choice, "auto");
    assert.deepEqual(params.tools, [{ type: "web_search", external_web_access: true, search_context_size: "medium", user_location: { type: "approximate", city: "Phuket", region: "Phuket", country: "TH", timezone: "Asia/Bangkok" } }]);
  }), "gpt-test", "Чем отличаются районы?");
  assert.equal(result.usedWebSearch, false);
});

test("a live request detects web search and preserves citation URLs", async () => {
  const output = [
    { type: "web_search_call", id: "search_1", status: "completed", action: { type: "search", query: "Phuket events" } },
    { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Сегодня есть маркет.", logprobs: [], annotations: [{ type: "url_citation", start_index: 0, end_index: 7, title: "Official", url: "https://example.com/event" }] }] },
  ] as unknown as Response["output"];
  const result = await generateAnswer(clientWith(response(output, "Сегодня есть маркет."), undefined, { freshness_sensitive: true, fallback: "Нет свежих данных." }), "gpt-test", "Что сегодня?");
  assert.equal(result.usedWebSearch, true);
  assert.deepEqual(result.sources, ["https://example.com/event"]);
});

test("a time-sensitive query accepts a current relevant source and grounds the query in today", async () => {
  const output = [
    { type: "web_search_call", id: "search_1", status: "completed", action: { type: "search", queries: ["Phuket weather now"], sources: [{ type: "url", url: "https://weather.example.com/phuket/current" }] } },
    { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Сейчас 29 °C.", logprobs: [], annotations: [{ type: "url_citation", start_index: 0, end_index: 13, title: "Current weather", url: "https://weather.example.com/phuket/current" }] }] },
  ] as unknown as Response["output"];
  const result = await generateAnswer(clientWith(response(output, "Сейчас 29 °C."), (params) => {
    assert.match(String(params.instructions), /now\/today/);
    assert.match(String(params.instructions), /Current Phuket local datetime: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  }, { freshness_sensitive: true, fallback: "Не удалось подтвердить свежие данные." }), "gpt-test", "Какая погода сейчас на Пхукете?");
  assert.equal(result.freshnessWarning, false);
  assert.equal(result.freshnessSensitiveQuery, true);
});

test("model-driven freshness routing works across Russian, English, Thai, and German", async () => {
  const questions = [
    "Какая погода сейчас на Пхукете?",
    "What's the weather in Phuket right now?",
    "ภูเก็ตอากาศตอนนี้เป็นอย่างไร",
    "Wie ist das Wetter gerade in Phuket?",
  ];
  for (const question of questions) {
    const output = [
      { type: "web_search_call", id: "search_1", status: "completed", action: { type: "search", sources: [{ type: "url", url: "https://weather.example.com/phuket/current" }] } },
      { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Weather answer", logprobs: [], annotations: [{ type: "url_citation", start_index: 0, end_index: 7, title: "Live weather", url: "https://weather.example.com/phuket/current" }] }] },
    ] as unknown as Response["output"];
    const result = await generateAnswer(clientWith(response(output, "Weather answer"), (params) => {
      assert.equal(params.tool_choice, "required");
    }, { freshness_sensitive: true, fallback: "Localized fallback" }), "gpt-test", question);
    assert.equal(result.freshnessSensitiveQuery, true, question);
  }
});

test("a stable foreign-language query is not routed to mandatory live search", async () => {
  const result = await generateAnswer(clientWith(response([], "Bang Tao ist ruhiger."), (params) => {
    assert.equal(params.tool_choice, "auto");
  }, { freshness_sensitive: false, fallback: "Aktuelle Daten konnten nicht bestätigt werden." }), "gpt-test", "Welcher Stadtteil eignet sich für Familien?");
  assert.equal(result.freshnessSensitiveQuery, false);
  assert.equal(result.usedWebSearch, false);
});

test("freshness fallback comes from the model in the user's language", async () => {
  const thaiFallback = "ไม่สามารถยืนยันข้อมูลปัจจุบันจากแหล่งข้อมูลที่ใหม่เพียงพอได้";
  const output = [{ type: "web_search_call", id: "search_1", status: "completed", action: { type: "search" } }] as unknown as Response["output"];
  const result = await generateAnswer(clientWith(response(output, "Unverified value"), undefined, {
    freshness_sensitive: true,
    fallback: thaiFallback,
  }), "gpt-test", "ภูเก็ตอากาศตอนนี้เป็นอย่างไร");
  assert.equal(result.text, thaiFallback);
  assert.equal(result.freshnessWarning, true);
});

test("an old archive cannot support a current answer or historical average", async () => {
  const output = [
    { type: "web_search_call", id: "search_1", status: "completed", action: { type: "search", sources: [{ type: "url", url: "https://weather.example.com/phuket" }] } },
    { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Сейчас 28 °C по средним значениям декабря.", logprobs: [], annotations: [{ type: "url_citation", start_index: 0, end_index: 10, title: "December 2024 archive", url: "https://weather.example.com/phuket" }] }] },
  ] as unknown as Response["output"];
  const result = await generateAnswer(clientWith(response(output, "Сейчас 28 °C по средним значениям декабря."), undefined, { freshness_sensitive: true, fallback: "Не удалось подтвердить актуальные данные." }), "gpt-test", "Какая погода сейчас на Пхукете?");
  assert.equal(result.freshnessWarning, true);
  assert.doesNotMatch(result.text, /28 °C/);
  assert.match(result.text, /не удалось подтвердить/i);
});

test("duplicate and tracked source URLs collapse to one canonical source", async () => {
  const output = [
    { type: "web_search_call", id: "search_1", status: "completed", action: { type: "search" } },
    { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Открыто до 22:00.", logprobs: [], annotations: [
      { type: "url_citation", start_index: 0, end_index: 7, title: "Official", url: "https://example.com/hours?utm_source=openai" },
      { type: "url_citation", start_index: 0, end_index: 7, title: "Official", url: "https://example.com/hours" },
    ] }] },
  ] as unknown as Response["output"];
  const result = await generateAnswer(clientWith(response(output, "Открыто до 22:00."), undefined, { freshness_sensitive: true, fallback: "Нет свежих данных." }), "gpt-test", "Во сколько сегодня закрывается?");
  assert.equal(result.sourceCount, 2);
  assert.deepEqual(result.sources, ["https://example.com/hours"]);
  assert.equal(normalizeSourceUrl("https://example.com/hours?utm_source=openai"), "https://example.com/hours");
});

test("identical paragraphs are emitted once even when citations differ", () => {
  const text = "Сейчас тепло. https://example.com/a\n\nСейчас тепло. https://example.com/a?utm_source=openai\n\nВозьми зонт.";
  assert.equal(deduplicateParagraphs(text), "Сейчас тепло. https://example.com/a\n\nВозьми зонт.");
});

test("a live query without sources gets a freshness fallback", async () => {
  const output = [{ type: "web_search_call", id: "search_1", status: "completed", action: { type: "search" } }] as unknown as Response["output"];
  const result = await generateAnswer(clientWith(response(output, "Кажется, открыто."), undefined, { freshness_sensitive: true, fallback: "Не удалось подтвердить свежие данные." }), "gpt-test", "Работает ли сейчас ресторан?");
  assert.equal(result.freshnessWarning, true);
  assert.match(result.text, /не удалось подтвердить/i);
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

test("Telegram uses a model-generated fallback for languages without hardcoded messages", async () => {
  const sent: string[] = [];
  const error = Object.assign(new Error("provider unavailable"), { localizedFallback: "ไม่สามารถรับข้อมูลล่าสุดได้ในขณะนี้" });
  await processUpdate({ message: { chat: { id: 1 }, text: "ภูเก็ตอากาศตอนนี้เป็นอย่างไร" } }, {
    answer: async () => { throw error; }, send: async (_id, text) => { sent.push(text); }, log: { info() {}, error() {} },
  });
  assert.equal(sent[0], error.localizedFallback);
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

test("current-message language instruction covers language changes", async () => {
  for (const question of ["What weather now?", "Какая погода сейчас?", "อากาศตอนนี้เป็นอย่างไร"]) {
    await generateAnswer(clientWith(response([], "answer"), (params) => assert.match(String(params.instructions), /language of THIS user message is authoritative/i)), "gpt-test", question);
  }
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
