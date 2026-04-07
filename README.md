# AI Manager

Backend для AI-менеджера в чатах: **Telegram** и **WhatsApp** (webhook), общая диалоговая логика, скрипты продаж из JSON, сохранение истории в **PostgreSQL**, опционально **локальная LLM через Ollama**.

Подробности промпта и плана развития: [PROMPT_PLAN.md](./PROMPT_PLAN.md). Текущий статус разработки: [DEVELOPMENT_CONTEXT.md](./DEVELOPMENT_CONTEXT.md).

---

## Требования

- **Node.js** 20+ (LTS)
- **Docker** и **Docker Compose** (для PostgreSQL)
- **ngrok** (или другой HTTPS-туннель) — для Telegram/WhatsApp webhook с локальной машины
- **Ollama** — если включена генерация ответов через LLM (`LLM_ENABLED=true`)

---

## Быстрый старт

### 1. Клонирование и зависимости

```bash
cd ai-manager
npm install
```

### 2. Переменные окружения

Скопируй пример и отредактируй:

```bash
cp .env.example .env
```

Файл `.env` в git не коммитится (см. `.gitignore`). Все секреты только там.

### 3. PostgreSQL

Поднять контейнер:

```bash
docker compose up -d postgres
```

По умолчанию в `.env.example` указан URL:

`postgresql://postgres:postgres@localhost:5432/ai_manager?schema=public`

### 4. Миграции Prisma

```bash
npm run prisma:migrate
```

При первом запуске создастся схема БД. Для просмотра данных: `npm run prisma:studio`.

### 5. Сборка и запуск

Разработка (hot-подобный режим через `ts-node`):

```bash
npm run start:dev
```

Продакшен-сборка:

```bash
npm run build
npm start
```

API по умолчанию: **http://localhost:3000** (порт задаётся `PORT`).

### 6. Проверка, что сервер жив

```bash
curl -s http://localhost:3000/health
```

Ожидается JSON со статусом `ok`.

---

## Telegram + ngrok (локальная разработка)

Telegram шлёт webhook только на **публичный HTTPS**. Для работы с `localhost` нужен туннель.

### Установка ngrok (macOS, Homebrew)

```bash
brew install ngrok/ngrok/ngrok
```

Рекомендуется один раз привязать аккаунт (токен из [dashboard ngrok](https://dashboard.ngrok.com)):

```bash
ngrok config add-authtoken <YOUR_NGROK_AUTHTOKEN>
```

### Запуск туннеля

В одном терминале — API бота:

```bash
npm run start:dev
```

В другом — туннель на порт приложения (по умолчанию 3000):

```bash
ngrok http 3000
```

В выводе ngrok возьми HTTPS-URL, например: `https://abc123.ngrok-free.app`.

### Настройка `.env` для Telegram

Обязательно укажи **полный путь** до webhook-эндпоинта:

```env
TELEGRAM_BOT_TOKEN=<токен от @BotFather>
TELEGRAM_WEBHOOK_URL=https://abc123.ngrok-free.app/webhooks/telegram
```

Важно: URL должен заканчиваться на **`/webhooks/telegram`**, иначе Telegram получит `404` и бот не ответит.

### Регистрация webhook у Telegram

Из корня проекта:

```bash
npm run telegram:webhook:set
npm run telegram:webhook:info
```

В `telegram:webhook:info` проверь:

- в `result.url` указан именно `https://.../webhooks/telegram`;
- нет `last_error_message` (или после исправления URL ошибка пропала).

Полезные команды:

```bash
npm run telegram:webhook:delete   # сбросить webhook
```

### Проверка без Telegram

```bash
curl -s https://<твой-ngrok>/webhooks/telegram/health
```

Ожидается JSON с `"channel":"telegram"`.

---

## WhatsApp (Meta Cloud API / совместимые провайдеры)

1. В кабинете Meta (или у BSP) настрой webhook:
   - **Callback URL**: `https://<твой-домен-или-ngrok>/webhooks/whatsapp`
   - **Verify token**: то же значение, что в `WHATSAPP_VERIFY_TOKEN`

2. В `.env`:

```env
WHATSAPP_VERIFY_TOKEN=<секрет для verify>
WHATSAPP_ACCESS_TOKEN=<токен отправки сообщений>
WHATSAPP_PHONE_NUMBER_ID=<id номера>
WHATSAPP_APP_SECRET=<App Secret из настроек приложения Meta>
```

Подпись входящих запросов: заголовок `X-Hub-Signature-256`. Если `WHATSAPP_APP_SECRET` не задан, в dev подпись **не проверяется** (в лог пишется предупреждение).

Для локальной отладки снова используй **ngrok** с HTTPS-URL на тот же порт, что и API.

---

## Локальная LLM (Ollama)

1. Установи [Ollama](https://ollama.com), скачай модель:

```bash
ollama pull llama3:latest
```

2. Проверка API:

```bash
curl -s http://127.0.0.1:11434/api/tags
```

Список моделей не должен быть пустым.

3. В `.env`:

```env
LLM_ENABLED=true
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL=llama3:latest
LLM_API_KEY=ollama
LLM_TEMPERATURE=0.35
LLM_MAX_TOKENS=400
```

4. Рамка темы и запреты (рекомендуется):

```env
COMPANY_NAME=Название компании
LLM_TOPIC=Кратко: о чём можно говорить в чате
LLM_FORBIDDEN_TOPICS=политика,религия,...
# LLM_SCOPE_FILE=config/llm-scope.txt
```

Шаблон текста для scope: [config/llm-scope.example.txt](./config/llm-scope.example.txt).

Если `LLM_ENABLED=false` или Ollama недоступна, ответы идут из шаблонов в [scripts/sales-scripts.json](./scripts/sales-scripts.json).

Сообщение `listen tcp 127.0.0.1:11434: address already in use` означает, что Ollama **уже запущена** — второй раз `ollama serve` не нужен.

---

## Полезные npm-скрипты

| Команда | Назначение |
|--------|------------|
| `npm run start:dev` | Запуск в режиме разработки |
| `npm run build` | Сборка TypeScript |
| `npm start` | Запуск собранного `dist/main.js` |
| `npm run prisma:migrate` | Миграции БД |
| `npm run prisma:generate` | Генерация Prisma Client |
| `npm run prisma:studio` | UI для данных в БД |
| `npm run telegram:webhook:set` | Установить Telegram webhook из `TELEGRAM_WEBHOOK_URL` |
| `npm run telegram:webhook:info` | Текущий webhook и ошибки доставки |
| `npm run telegram:webhook:delete` | Удалить webhook |

---

## Структура эндпоинтов (кратко)

| Метод | Путь | Назначение |
|--------|------|------------|
| GET | `/health` | Healthcheck |
| GET | `/webhooks/telegram/health` | Проверка канала Telegram через туннель |
| POST | `/webhooks/telegram` | Входящие обновления Telegram |
| GET | `/webhooks/whatsapp` | Верификация webhook (challenge) |
| POST | `/webhooks/whatsapp` | Входящие события WhatsApp |

---

## Типичные проблемы

| Симптом | Что проверить |
|--------|----------------|
| Telegram не отвечает | `TELEGRAM_WEBHOOK_URL` заканчивается на `/webhooks/telegram`; `npm run telegram:webhook:set`; ngrok и `npm run start:dev` запущены |
| `404` в `last_error_message` у Telegram | В webhook указан только корень ngrok без пути `/webhooks/telegram` |
| Сменился URL ngrok | Обновить `TELEGRAM_WEBHOOK_URL` и снова `npm run telegram:webhook:set` |
| Ollama: `models: []` | Выполнить `ollama pull <модель>` |
| Ответы «шаблонные», не LLM | `LLM_ENABLED=true`, верный `LLM_MODEL`, Ollama доступна с машины, где крутится Node |
| Ошибки БД | `docker compose up -d postgres`, корректный `DATABASE_URL`, выполнены миграции |

---

## Redis

В `docker-compose.yml` есть сервис **redis**; для текущего MVP очередь BullMQ может быть ещё не подключена к обработке webhook. При необходимости подними Redis:

```bash
docker compose up -d redis
```

---

## Документы проекта

- [PROMPT_PLAN.md](./PROMPT_PLAN.md) — роль бота, промпт, скрипты, KPI
- [TECH_STACK.md](./TECH_STACK.md) — стек и архитектура
- [DEVELOPMENT_CONTEXT.md](./DEVELOPMENT_CONTEXT.md) — что сделано и что дальше
