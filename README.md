# PhuketGuide AI Bot — MVP v0.1

Telegram-бот `@phuketguide_ai_bot` отвечает на естественном языке на вопросы об отдыхе и жизни на Пхукете. Это минимальная stateless-версия: история диалога и база данных пока не используются.

## Как это работает

`Telegram → защищённый webhook /api/telegram в Vercel → OpenAI Responses API → Telegram API → пользователь`

Webhook принимает только запросы с секретным заголовком Telegram. Команды `/start` и `/help` отвечают без обращения к OpenAI. Длинные ответы автоматически разбиваются на несколько сообщений.

## Что потребуется

Получите ключ OpenAI в кабинете OpenAI. Токен уже созданного бота выдаёт BotFather. Также придумайте случайный секрет webhook (латинские буквы, цифры, `_` и `-`, от 1 до 256 символов). Никому их не отправляйте и не добавляйте в GitHub.

| Переменная | Значение |
|---|---|
| `TELEGRAM_BOT_TOKEN` | токен `@phuketguide_ai_bot` от BotFather |
| `OPENAI_API_KEY` | секретный ключ OpenAI API |
| `OPENAI_MODEL` | модель; рекомендуется недорогая `gpt-4.1-mini` |
| `TELEGRAM_WEBHOOK_SECRET` | самостоятельно созданная случайная строка |

## Деплой в Vercel (без написания кода)

1. Войдите на [vercel.com](https://vercel.com) через GitHub и нажмите **Add New → Project**.
2. Выберите этот GitHub-репозиторий и нажмите **Import**. Framework Preset оставьте **Other**; остальные build-настройки менять не нужно.
3. Раскройте **Environment Variables**, по очереди добавьте четыре переменные из таблицы. Выберите окружения Production, Preview и Development. Значения не должны содержать кавычки.
4. Нажмите **Deploy** и дождитесь статуса **Ready**.
5. На странице deployment нажмите **Visit** или скопируйте домен из **Domains**. Production URL выглядит как `https://имя-проекта.vercel.app`.

Если позже значение переменной изменилось: откройте **Project → Settings → Environment Variables**, измените его, затем в **Deployments** у последнего deployment выберите **Redeploy**.

## Один раз подключить Telegram webhook

На компьютере с клоном репозитория установите Node.js 20+, откройте терминал в папке проекта и выполните:

```bash
npm install
cp .env.example .env.local
```

Откройте `.env.local` обычным текстовым редактором и вставьте те же значения секретов. Этот файл исключён из Git и не будет опубликован. Затем подставьте **свой** production URL:

```bash
WEBHOOK_URL=https://имя-проекта.vercel.app npm run webhook:set
```

Успешный результат содержит `"ok": true`. Скрипт безопасно передаёт токен Telegram API и устанавливает endpoint `https://имя-проекта.vercel.app/api/telegram`; токен не записывается в URL или репозиторий.

Проверить состояние webhook можно так:

```bash
npm run webhook:info
```

В ответе проверьте правильный `url`, пустое значение `last_error_message` и после тестового сообщения — обновление `pending_update_count`. Если production-домен поменялся, повторите `webhook:set` с новым URL.

## Проверка бота

1. Откройте в Telegram `@phuketguide_ai_bot` и нажмите **Start**.
2. Отправьте `/help`.
3. Напишите: «Где лучше встретить закат на Пхукете?» — бот должен ответить в тот же чат.
4. Можно отправить фото или стикер: неподдерживаемый тип будет спокойно проигнорирован.

## Если бот не отвечает

1. Выполните `npm run webhook:info` и посмотрите `last_error_message`.
2. В Vercel откройте проект → **Logs**, выберите Production и функцию `/api/telegram`. Там видны безопасные сообщения об ошибках без вывода ключей.
3. Убедитесь в **Settings → Environment Variables**, что заданы все четыре значения, затем сделайте Redeploy.
4. Проверьте наличие средств/API-доступа в аккаунте OpenAI.

При временной ошибке OpenAI пользователь получает понятное предложение повторить запрос. Технические stack trace пользователю не показываются.

## Обновления и локальные проверки

После каждого нового push в основную ветку GitHub Vercel автоматически создаёт production deployment. Push в другие ветки создаёт Preview и не переключает Telegram с production URL.

Для проверки проекта разработчиком:

```bash
npm install
npm run typecheck
npm test
npm run build
```

Локальный `.env.local` нужен только скриптам webhook; Vercel получает секреты из настроек проекта.
