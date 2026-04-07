# Development Context

## Project
- Name: `ai-manager`
- Goal: AI-менеджер для консультаций и продаж в чатах (Telegram, WhatsApp, др.)
- Current stage: Инициализация проекта

## Implemented
- Создан документ `PROMPT_PLAN.md` с базовой архитектурой промпта и планом итераций.
- Зафиксирован целевой технологический стек (см. `TECH_STACK.md`).
- Инициализирован backend-каркас (NestJS + TypeScript).
- Добавлены `docker-compose.yml` (PostgreSQL + Redis) и `prisma/schema.prisma`.
- Добавлен WhatsApp webhook модуль (`GET` verify + `POST` receive/send text).
- Добавлен Telegram webhook модуль (`POST` receive/send text).
- Добавлены команды управления Telegram webhook и `.gitignore` для защиты `.env`.
- Добавлен общий `DialogService` для единых ответов в Telegram/WhatsApp.
- Добавено сохранение входящих/исходящих сообщений в PostgreSQL через Prisma.
- Применена первая Prisma миграция `init` к PostgreSQL.
- Вынесены sales-скрипты и правила stage-переходов в `scripts/sales-scripts.json`.
- Добавлены handoff-правила в конфиг и запись событий в `handoff_events`.
- Добавлена idempotency-обработка входящих сообщений (Telegram/WhatsApp) по `messageId`.
- Добавлена проверка подписи WhatsApp webhook (`X-Hub-Signature-256` + `WHATSAPP_APP_SECRET`).
- Применена Prisma миграция `add_idempotency` для таблицы обработанных входящих сообщений.
- Подключена локальная LLM через Ollama (OpenAI-compatible `/v1/chat/completions`), fallback на `sales-scripts.json`.
- Настраиваемая «рамка темы»: `LLM_TOPIC`, `LLM_FORBIDDEN_TOPICS`, `LLM_SCOPE_FILE`, `LLM_MAX_TOKENS` в системном промпте.
- Документация запуска: `README.md` (ngrok, Telegram/WhatsApp, Ollama, Prisma).

## In Progress
- Уточнение sales-FSM логики и A/B вариантов скриптов.

## Next
1. Добавить Redis + очередь задач для асинхронной обработки.
2. Настроить Telegram/WhatsApp production webhook URLs.
3. Добавить A/B варианты sales-скриптов в конфиг.
4. Добавить уведомление менеджера при handoff событии.
5. Добавить retry/backoff для неуспешной отправки сообщений в каналы.
6. Добавить базовые метрики конверсии по этапам воронки.

## Architecture Decisions
- Единый слой каналов: адаптеры для каждого мессенджера.
- Отдельный слой диалоговой логики: этапы воронки продаж.
- Отдельный слой знаний/контента: FAQ, офферы, возражения.
- Основной backend: NestJS (TypeScript), REST + webhook endpoints.
- Хранение состояния и истории: PostgreSQL (через Prisma ORM).
- Очереди и кэш: Redis + BullMQ.

## Risks / Open Questions
- Выбор провайдера для WhatsApp (официальный API vs BSP).
- Требования по хранению персональных данных.
- Границы полномочий AI и правила эскалации человеку.
- Выбор финального поставщика LLM и политика контроля затрат.

## Change Log
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
