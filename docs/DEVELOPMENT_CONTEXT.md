# Development Context

## Project
- Name: `ai-manager`
- Goal: AI-менеджер для консультаций и продаж в чатах (Telegram, WhatsApp, др.)
- Current stage: MVP core — входящие сообщения по умолчанию через **BullMQ** (быстрый ACK вебхука); при `DIALOG_QUEUE_ENABLED=false` — синхронная обработка в вебхуке без Redis.

## Implemented
- Инициализирован backend-каркас (NestJS + TypeScript).
- Добавлены `docker-compose.yml` (PostgreSQL + Redis; без устаревшего ключа `version`, без фиксированных `container_name` — имена контейнеров задаёт Compose) и `prisma/schema.prisma`.
- **BullMQ** (`DialogQueueModule`): очередь `dialog-inbound`. После idempotency вебхук Telegram/WhatsApp ставит job и отвечает провайдеру; `DialogQueueWorkerService` в том же процессе вызывает `TelegramService` / `WhatsAppService` → `processInboundQueued` (LLM + отправка). `TelegramModule` / `WhatsAppModule` **экспортируют** сервисы для внедрения в воркер. Переменные: `DIALOG_QUEUE_ENABLED`, `DIALOG_QUEUE_WORKER_ENABLED`, `DIALOG_QUEUE_CONCURRENCY`, опционально `DIALOG_QUEUE_ATTEMPTS`, `DIALOG_QUEUE_BACKOFF_MS`, `REDIS_PASSWORD`. **Custom `jobId`**: `telegram-<messageId>`, `whatsapp-<id>` (символ `:` в id запрещён BullMQ). При ошибке `enqueue` — `IdempotencyService.revert` для повторной доставки вебхука.
- Мониторинг очереди: `GET /health/queue` (счётчики Redis; при недоступности Redis — 503). В dev логируются постановка в очередь и события воркера `[Queue] job active` / `job completed`.
- Добавлен WhatsApp webhook модуль (`GET` verify + `POST` receive/send text).
- Добавлен Telegram webhook модуль (`POST` receive/send text).
- Добавлены команды управления Telegram webhook и `.gitignore` для защиты `.env`.
- Добавлен общий `DialogService` для единых ответов в Telegram/WhatsApp.
- Добавлено сохранение входящих/исходящих сообщений в PostgreSQL через Prisma.
- Применена первая Prisma миграция `init` к PostgreSQL.
- Вынесены sales-скрипты и правила stage-переходов в `scripts/sales-scripts.json`.
- Добавлены handoff-триггеры в конфиг (`handoff.handOffTriggers` в JSON скриптов) и запись событий в `handoff_events`.
- Добавлена idempotency-обработка входящих сообщений (Telegram/WhatsApp) по `messageId`.
- Добавлена проверка подписи WhatsApp webhook (`X-Hub-Signature-256` + `WHATSAPP_APP_SECRET`).
- Применена Prisma миграция `add_idempotency` для таблицы обработанных входящих сообщений.
- Подключена локальная LLM через Ollama (OpenAI-compatible `/v1/chat/completions`), fallback на `sales-scripts.json`.
- Профили системного промпта (`PromptProfileModule`): JSON в `config/prompt-profiles/`; идентификатор профиля задаётся через сборку бота (см. ниже) или fallback `LLM_PROMPT_PROFILE`; длина ответа — `LLM_MAX_TOKENS`.
- **Конфигурации бота** (`BotConfigurationModule`, глобальный модуль): файл `config/configurations/<BOT_CONFIGURATION>.json` (переменная окружения `BOT_CONFIGURATION`, по умолчанию `default`). В сборке указываются `llmPromptProfile` (имя файла без `.json` из `prompt-profiles/`) и `salesScriptsPath` (путь к JSON скриптов продаж от корня репозитория). Пример готовых сборок: `daria-mokko` (студия), `test-saas`, `test-fitness` — для переключения ниши при тестах.
- Расширенные поля профиля промпта: `persona`, `primaryGoals`, `servicesHighlight`, `neverDo`, `bookingAndContact`, `additionalStyleRules`, `language`, флаг **`humanLikeMode`** (более «живой» тон в системном промпте). Парсинг в `PromptProfileService`, сборка текста — `DialogService.buildSystemPrompt`.
- Резолв пользователя для диалога: `findFirst` по `channel` + `externalId` и `create` с обработкой гонки `P2002` (вместо `upsert` по составному unique в типах клиента).
- Логи цепочки сообщения в Telegram/WhatsApp: шаги `1/3`–`3/3` (получено → диалог → отправка в API), разбивка времени и total «webhook → ответ ушёл в канал»; только при `NODE_ENV=development` (`src/modules/shared/is-development.ts`).
- `LLM_CONTEXT_MESSAGES` ограничивает глубину истории в запросе к LLM; `LLM_TIMEOUT_MS` — `AbortSignal.timeout` на вызов Ollama, при срыве — fallback на скрипты.
- Документация запуска: `README.md` (ngrok, Telegram/WhatsApp, Ollama, Prisma, профили промпта).
- Описание потока бота: `docs/BOT_ALGORITHM.md` (вебхук → при включённой очереди: Redis job → воркер → БД → LLM → канал; иначе синхронно в вебхуке).

## In Progress
- Уточнение sales-FSM логики и A/B вариантов скриптов.

## Next
1. Настроить Telegram/WhatsApp production webhook URLs.
2. Добавить A/B варианты sales-скриптов в конфиг.
3. Добавить уведомление менеджера при handoff событии.
4. Добавить retry/backoff для неуспешной отправки сообщений в каналы.
5. Добавить базовые метрики конверсии по этапам воронки.

## Architecture Decisions
- Единый слой каналов: адаптеры для каждого мессенджера.
- Отдельный слой диалоговой логики: этапы воронки продаж.
- Отдельный слой знаний/контента: FAQ, офферы, возражения.
- Рамка LLM (компания, тема, запреты, опциональный `scopeFile`, режим «человечнее» и др.) — в файлах `config/prompt-profiles/*.json`; длинный текст не хранить в `.env`.
- Переключение «какой бот запущен» — **`BOT_CONFIGURATION`** → один JSON в `config/configurations/` связывает профиль промпта и путь к sales-скриптам; **`LLM_PROMPT_PROFILE`** используется как запасной вариант, если в сборке не задан `llmPromptProfile`.
- Основной backend: NestJS (TypeScript), REST + webhook endpoints.
- Хранение состояния и истории: PostgreSQL (через Prisma ORM).
- Очереди: Redis + BullMQ — очередь входящих диалогов `dialog-inbound` (`DialogQueueModule`); опционально отдельный инстанс API с `DIALOG_QUEUE_WORKER_ENABLED=false` и выделенный воркер — по мере масштабирования.
- `HealthModule` подключает `DialogQueueModule` для эндпоинта метрик очереди.

## Risks / Open Questions
- Выбор провайдера для WhatsApp (официальный API vs BSP).
- Требования по хранению персональных данных.
- Границы полномочий AI и правила эскалации человеку.
- Выбор финального поставщика LLM и политика контроля затрат.

## Change Log
- 2026-04-14: **Очередь входящих (BullMQ) в продакшен-пути**: `dialog-inbound`, `processInboundQueued`, `IdempotencyService.revert` при сбое enqueue; `jobId` без `:` (`telegram-…`, `whatsapp-…`); экспорт `TelegramService` / `WhatsAppService`; `GET /health/queue`; dev-логи очереди; `HealthModule` → `DialogQueueModule`. Docker Compose: убраны `version` и жёсткие `container_name`. Параметры в `.env.example`. (Запись от 2026-04-09 про «Redis без воркера» устарела.)
- 2026-04-14: Удалены таблица и модель Prisma `LeadState` (фактически дублировали последнее сообщение клиента; поля бюджета/сроков не использовались). Добавлена миграция `20260414120000_drop_lead_state`; убран `upsert` из `DialogService`; обновлён `docs/BOT_ALGORITHM.md`. После pull — `npx prisma migrate deploy` (или `migrate dev`).
- 2026-04-14: В блоке `handoff` sales-скриптов ключ триггеров переименован: `rules` → `handOffTriggers` (все файлы в `scripts/**/sales-scripts.json`); `DialogService` и fallback-конфиг в коде читают `handOffTriggers`; обновлён `docs/BOT_ALGORITHM.md`. Ранее сохранённые копии JSON со `handoff.rules` нужно перевести на новый ключ.
- 2026-04-13: Конфигурации бота (`BOT_CONFIGURATION`, `config/configurations/*.json`); расширенные поля профиля промпта и `humanLikeMode`; тестовые профили `test-saas` / `test-fitness` и сборка `daria-mokko`; обновлены `docs/BOT_ALGORITHM.md`, `docs/README.md`, `docs/TECH_STACK.md`.
- 2026-04-09: План развития вынесен в `docs/ROADMAP.md`; в контексте — ссылка после блока Next.
- 2026-04-09: Уточнён статус Redis/BullMQ (инфра + зависимости; воркер в коде подключён позже — см. Change Log 2026-04-14); добавлен черновик «План развития»; обновлён Next п.1; стадия проекта в шапке.
- 2026-04-09: Добавлен `docs/BOT_ALGORITHM.md` — алгоритм работы бота и роль таблиц БД; ссылка в `README.md`.
- 2026-04-09: Учтены `LLM_CONTEXT_MESSAGES` и `LLM_TIMEOUT_MS` в `DialogService` / `LlmService`; в README — подсказки по ускорению LLM.
- 2026-04-09: Логи обработки входящих сообщений Telegram/WhatsApp (этапы и тайминги) включены только в dev (`NODE_ENV=development`).
- 2026-04-09: Рамка промпта вынесена из `.env` в сменные профили `config/prompt-profiles/*.json`, модуль `PromptProfileModule`, выбор `LLM_PROMPT_PROFILE`.
- 2026-04-08: Добавлен `README.md` с инструкцией по запуску (Docker, Prisma, ngrok, Telegram/WhatsApp, Ollama).
- 2026-04-07: Инициализированы `PROMPT_PLAN.md` и `DEVELOPMENT_CONTEXT.md`.
- 2026-04-07: Зафиксирован целевой стек в `TECH_STACK.md` и обновлен roadmap.
- 2026-04-08: Создан MVP-каркас приложения (NestJS, Docker Compose, Prisma schema, health endpoint).
- 2026-04-08: Подключен базовый WhatsApp webhook модуль и отправка текстовых ответов.
- 2026-04-08: Подключен базовый Telegram webhook модуль и отправка текстовых ответов.
- 2026-04-08: Добавлены `telegram:webhook:*` команды и загрузка `.env` в рантайме.
- 2026-04-08: Реализован общий `DialogService` и запись входящих/исходящих сообщений в БД (Prisma).
- 2026-04-08: Выполнен `prisma migrate dev --name init`, создана и применена первая миграция.
- 2026-04-08: `DialogService` переведен на конфиг `scripts/sales-scripts.json` (тексты и правила).
- 2026-04-08: Реализован handoff (конфиг-триггеры, статус `HANDED_OFF`, запись в `handoff_events`).
- 2026-04-08: Добавлены idempotency (messageId) и валидация подписи WhatsApp webhook; применена миграция `add_idempotency`.
- 2026-04-08: Добавлен `LlmService` (Ollama OpenAI API) и генерация ответов в `DialogService` с fallback на скрипты.
- 2026-04-08: Расширен системный промпт (тема, запреты, файл scope) и опциональный `LLM_MAX_TOKENS`.
