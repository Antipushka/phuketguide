import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./prompt.js";

export function createAnswerGenerator(apiKey: string, model: string) {
  const client = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 1 });
  return async (question: string): Promise<string> => {
    const response = await client.responses.create({
      model,
      instructions: SYSTEM_PROMPT,
      input: question,
      max_output_tokens: 900,
    });
    const answer = response.output_text.trim();
    if (!answer) throw new Error("OpenAI returned an empty response");
    return answer;
  };
}
