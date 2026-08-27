export interface Config {
  telegramBotToken: string;
  openaiApiKey: string;
  openaiModel: string;
  webhookSecret: string;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = ["TELEGRAM_BOT_TOKEN", "OPENAI_API_KEY", "TELEGRAM_WEBHOOK_SECRET"] as const;
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN!.trim(),
    openaiApiKey: env.OPENAI_API_KEY!.trim(),
    openaiModel: env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET!.trim(),
  };
}
