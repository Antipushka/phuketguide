import assert from "node:assert/strict";
import test from "node:test";
import type { Response } from "openai/resources/responses/responses";
import { assessFreshness, isHistoricalReference } from "../src/freshness.js";
import { generateAnswer, type ResponsesClient } from "../src/openai.js";

const structured = (kind = "general") => kind === "places_list"
  ? JSON.stringify({ kind, language: "ru", heading: "Места", items: [
    { name: "Open", reason_to_choose: "Подтверждено", open_status: "open" },
    { name: "Unknown", reason_to_choose: "Нет часов", open_status: "unknown" },
  ] })
  : JSON.stringify({ kind: "general", language: "ru", paragraphs: ["Полезный ответ"] });

function fakeClient(requirement: "realtime" | "current" | "stable", answer: Response, openNow = false, currentWeather = false): ResponsesClient {
  let call = 0;
  return { responses: { async create() {
    call++;
    if (call === 1) return { output: [], output_text: JSON.stringify({ requirement, fallback: "Live data unavailable.", open_now: openNow, current_weather: currentWeather, response_kind: currentWeather ? "weather" : openNow ? "places_list" : "general" }) } as unknown as Response;
    return answer;
  } } };
}

function response(body: string, sources: Array<{ url: string; title?: string }> = []): Response {
  const annotations = sources.map((source) => ({ type: "url_citation", start_index: 0, end_index: 1, ...source }));
  const output: Response["output"] = [{ type: "web_search_call", id: "s", status: "completed", action: { type: "search", sources: sources.map(({ url }) => ({ type: "url", url })) } }, { type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text: body, logprobs: [], annotations }] }] as Response["output"];
  return { output, output_text: body } as Response;
}

test("stable questions are answerable without freshness evidence", () => {
  for (const question of ["Bang Tao или Rawai?", "Что посмотреть на Пхукете?"]) {
    const result = assessFreshness("stable", []);
    assert.equal(result.canAnswer, true, question);
  }
});

test("official undated business pages are usable and not automatically stale", () => {
  const assessment = assessFreshness("current", [{ authority: "official" }]);
  assert.equal(assessment.canAnswer, true);
  assert.equal(assessment.confidence, "medium");
});

test("current corroboration is high confidence while conflicts lower confidence", () => {
  assert.equal(assessFreshness("realtime", [{ authority: "official", datedCurrent: true }]).confidence, "high");
  const conflict = assessFreshness("realtime", [{ authority: "official" }, { authority: "business_listing" }], true);
  assert.deepEqual([conflict.confidence, conflict.canAnswer], ["low", false]);
});

test("historical and climate references cannot establish a realtime claim", () => {
  assert.equal(isHistoricalReference("https://weather.test/archive/2024", "Monthly climate averages", 2026), true);
  assert.equal(assessFreshness("realtime", [{ authority: "historical", historical: true }]).canAnswer, false);
});

test("soft-current recommendations survive missing publication timestamps", async () => {
  const result = await generateAnswer(fakeClient("current", response(structured(), [{ url: "https://restaurant.test/menu", title: "Official restaurant" }])), "test", "Посоветуй рестораны на Bang Tao");
  assert.equal(result.freshnessWarning, false);
  assert.equal(result.structured?.kind, "general");
});

test("realtime without evidence suppresses an exact value but current requests allow partial answers", async () => {
  const exact = await generateAnswer(fakeClient("realtime", response(structured())), "test", "Какой курс сейчас?");
  assert.equal(exact.structured?.kind, "freshness_fallback");
  const partial = await generateAnswer(fakeClient("current", response(structured())), "test", "Где поменять USD?");
  assert.equal(partial.structured?.kind, "general");
});

test("open-now output retains confirmed OPEN only", async () => {
  const result = await generateAnswer(fakeClient("realtime", response(structured("places_list"), [{ url: "https://venue.test/hours", title: "Official hours" }]), true), "test", "Что открыто сейчас?");
  assert.equal(result.structured?.kind, "places_list");
  if (result.structured?.kind !== "places_list") assert.fail();
  assert.deepEqual(result.structured.items.map((item) => item.name), ["Open"]);
});

const currentWeather = JSON.stringify({ kind: "weather", language: "ru", heading: "Пхукет сейчас", temperature: "+29°C", condition: "Облачно" });

test("unqualified multilingual weather intents default to current Phuket weather without clarification", async () => {
  for (const question of ["Какая погода?", "Какая погода на Пхукете?", "How's the weather?", "อากาศเป็นอย่างไรบ้าง?"]) {
    const result = await generateAnswer(fakeClient("realtime", response(currentWeather), false, true), "test", question);
    assert.equal(result.structured?.kind, "weather", question);
    assert.equal(result.freshnessRequirement, "realtime", question);
    assert.doesNotMatch(JSON.stringify(result.structured), /уточн|clarif/i, question);
  }
});

test("completed realtime web search can ground valid weather without webpage URLs", async () => {
  const result = await generateAnswer(fakeClient("realtime", response(currentWeather), false, true), "test", "Какая погода?");
  assert.equal(result.freshnessWarning, false);
  assert.equal(result.realtimeEvidenceType, "web_search_tool");
  assert.equal(result.realtimeToolEvidencePresent, true);
  assert.equal(result.webpageSourceCount, 0);
});

test("historical-only weather webpages override generic search completion", async () => {
  const historical = response(currentWeather, [{ url: "https://weather.test/archive/2024", title: "Phuket monthly climate averages 2024" }]);
  const result = await generateAnswer(fakeClient("realtime", historical, false, true), "test", "Какая погода?");
  assert.equal(result.structured?.kind, "freshness_fallback");
  assert.equal(result.freshnessWarningReason, "historical_only");
});

test("weather without realtime evidence falls back", async () => {
  const noTool = { output: [], output_text: currentWeather } as unknown as Response;
  const result = await generateAnswer(fakeClient("realtime", noTool, false, true), "test", "How's the weather?");
  assert.equal(result.structured?.kind, "freshness_fallback");
  assert.equal(result.freshnessWarningReason, "no_search");
});

test("incomplete structured weather stays behind the safe fallback even after tool execution", async () => {
  const incomplete = JSON.stringify({ kind: "weather", language: "en", heading: "Phuket" });
  const result = await generateAnswer(fakeClient("realtime", response(incomplete), false, true), "test", "How's the weather?");
  assert.equal(result.structured?.kind, "freshness_fallback");
  assert.equal(result.realtimeToolEvidencePresent, false);
  assert.equal(result.structuredResponseValid, false);
});
