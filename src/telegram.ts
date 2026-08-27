const TELEGRAM_CHUNK_SIZE = 4000;

export interface TelegramMessage { chat: { id: number }; text?: string }
export interface TelegramUpdate { update_id?: number; message?: TelegramMessage }
export type SendMessage = (chatId: number, text: string) => Promise<void>;
export type SendChatAction = (chatId: number, action: "typing") => Promise<void>;
export interface BotAnswer { text: string; usedWebSearch?: boolean; sources?: string[] }

export const START_TEXT = `Привет! Я PhuketGuide AI — твой AI-помощник по Пхукету.

Можешь просто написать, что тебя интересует: куда сходить, где поесть, какой район выбрать, где арендовать машину или байк, где жить или что посмотреть.

Просто задавай вопрос обычным сообщением.`;

export const HELP_TEXT = `Я отвечаю на практические вопросы об отдыхе и жизни на Пхукете. Например:

• Куда сходить вечером на Bang Tao?
• Где лучше жить месяц на Пхукете?
• Что посмотреть за 3 дня?
• Какой район выбрать с ребёнком?
• Где обычно выгоднее менять доллары?`;

export function splitMessage(text: string, limit = TELEGRAM_CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const candidate = rest.slice(0, limit + 1);
    let cut = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf(" "));
    if (cut < limit * 0.6) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function createTelegramSender(token: string): SendMessage {
  return async (chatId, text) => {
    for (const chunk of splitMessage(text)) {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: chunk }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Telegram API request failed with status ${response.status}`);
    }
  };
}

export function createTelegramChatActionSender(token: string): SendChatAction {
  return async (chatId, action) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Telegram chat action failed with status ${response.status}`);
  };
}

function command(text: string): string | undefined {
  return text.trim().split(/\s+/, 1)[0]?.toLowerCase().replace(/@phuketguide_ai_bot$/, "");
}

export async function processUpdate(
  update: TelegramUpdate,
  deps: {
    answer: (text: string) => Promise<string | BotAnswer>;
    send: SendMessage;
    sendChatAction?: SendChatAction;
    log?: Pick<Console, "error"> & Partial<Pick<Console, "info">>;
  },
): Promise<void> {
  const message = update.message;
  if (!message || typeof message.text !== "string" || !message.text.trim()) return;
  const chatId = message.chat.id;
  const cmd = command(message.text);
  if (cmd === "/start") return deps.send(chatId, START_TEXT);
  if (cmd === "/help") return deps.send(chatId, HELP_TEXT);

  const startedAt = Date.now();
  try {
    (deps.log ?? console).info?.("Telegram request received");
    if (deps.sendChatAction) {
      await deps.sendChatAction(chatId, "typing").catch((error) =>
        (deps.log ?? console).error("Could not send Telegram chat action", error instanceof Error ? error.name : "UnknownError"),
      );
    }
    const result = await deps.answer(message.text.trim());
    const answer = typeof result === "string" ? { text: result, usedWebSearch: false } : result;
    (deps.log ?? console).info?.("OpenAI request succeeded", {
      durationMs: Date.now() - startedAt,
      usedWebSearch: Boolean(answer.usedWebSearch),
    });
    await deps.send(chatId, answer.text);
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "UnknownError";
    (deps.log ?? console).error("Could not generate or deliver an AI response", {
      durationMs: Date.now() - startedAt,
      errorType,
    });
    try {
      const isRussian = /[а-яё]/i.test(message.text);
      const timedOut = errorType.toLowerCase().includes("timeout");
      await deps.send(chatId, isRussian
        ? timedOut
          ? "Сейчас не удалось быстро проверить актуальную информацию. Попробуй ещё раз через минуту."
          : "Сейчас не получилось получить ответ. Попробуй ещё раз через минуту."
        : timedOut
          ? "I couldn't check the latest information quickly enough. Please try again in a minute."
          : "I couldn't get an answer right now. Please try again in a minute.");
    } catch (sendError) {
      (deps.log ?? console).error("Could not deliver the fallback message", sendError);
    }
  }
}
