const TELEGRAM_CHUNK_SIZE = 4000;

export interface TelegramMessage { chat: { id: number }; text?: string }
export interface TelegramUpdate { update_id?: number; message?: TelegramMessage }
export type SendMessage = (chatId: number, text: string) => Promise<void>;

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

function command(text: string): string | undefined {
  return text.trim().split(/\s+/, 1)[0]?.toLowerCase().replace(/@phuketguide_ai_bot$/, "");
}

export async function processUpdate(
  update: TelegramUpdate,
  deps: { answer: (text: string) => Promise<string>; send: SendMessage; log?: Pick<Console, "error"> },
): Promise<void> {
  const message = update.message;
  if (!message || typeof message.text !== "string" || !message.text.trim()) return;
  const chatId = message.chat.id;
  const cmd = command(message.text);
  if (cmd === "/start") return deps.send(chatId, START_TEXT);
  if (cmd === "/help") return deps.send(chatId, HELP_TEXT);

  try {
    await deps.send(chatId, await deps.answer(message.text.trim()));
  } catch (error) {
    (deps.log ?? console).error("Could not generate or deliver an AI response", error);
    try {
      await deps.send(chatId, "Сейчас не получилось получить ответ. Пожалуйста, попробуйте ещё раз через минуту.");
    } catch (sendError) {
      (deps.log ?? console).error("Could not deliver the fallback message", sendError);
    }
  }
}
