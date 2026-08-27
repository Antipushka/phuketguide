import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";
import { SYSTEM_PROMPT } from "./prompt.js";

export const OPENAI_TIMEOUT_MS = 25_000;

export interface AnswerResult {
  text: string;
  usedWebSearch: boolean;
  sources: string[];
}

export interface ResponsesClient {
  responses: {
    create(params: Record<string, unknown>): Promise<Response>;
  };
}

function getSources(response: Response): string[] {
  const urls = new Set<string>();
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const content of item.content) {
      if (content.type !== "output_text") continue;
      for (const annotation of content.annotations) {
        if (annotation.type === "url_citation") urls.add(annotation.url);
      }
    }
  }
  return [...urls];
}

/** Runs one Responses API request and lets the model decide whether search is needed. */
export async function generateAnswer(client: ResponsesClient, model: string, question: string): Promise<AnswerResult> {
  const response = await client.responses.create({
    model,
    instructions: SYSTEM_PROMPT,
    input: question,
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
    include: ["web_search_call.action.sources"],
    max_output_tokens: 900,
  });
  const text = response.output_text.trim();
  if (!text) throw new Error("OpenAI returned an empty response");
  return {
    text,
    usedWebSearch: response.output.some((item) => item.type === "web_search_call"),
    sources: getSources(response),
  };
}

export function createAnswerGenerator(apiKey: string, model: string) {
  const client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 1 });
  return (question: string): Promise<AnswerResult> => generateAnswer(client, model, question);
}
