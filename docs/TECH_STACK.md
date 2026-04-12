# Tech Stack

## 1) Цели выбора стека
- Быстрый запуск MVP.
- Удобная поддержка multi-channel архитектуры.
- Масштабируемость под рост диалогов и каналов.
- Простота поддержки sales-логики и сценариев.

## 2) Основной стек
- Runtime: `Node.js` (LTS)
- Language: `TypeScript`
- Framework: `NestJS`
- Database: `PostgreSQL`
- ORM: `Prisma`
- Cache/Queue: `Redis` + `BullMQ` (цель). **Сейчас:** Redis в `docker-compose.yml`, пакеты `ioredis` и `bullmq` в проекте; воркер очереди в приложении ещё не подключён — обработка вебхуков синхронная.
- Logging: `Pino` (в зависимостях; в коде также Nest `Logger`)
- Errors/Observability: `Sentry` (опционально на MVP)
- Containerization: `Docker` + `Docker Compose`

## 3) Канальные интеграции
### Telegram
- В репозитории: прямой вызов Telegram Bot API из NestJS-модуля. `Telegraf` — возможная замена, не обязательна.
- Режимы: webhook (prod), polling (local dev) — при необходимости.

### WhatsApp
- BSP-провайдер через официальный WhatsApp Business API (рекомендуется `360dialog`).
- Входящие/исходящие события через webhook.

### Другие каналы
- Подключаются через общий интерфейс `ChannelAdapter`.
- Единая модель входящих сообщений и метаданных.

## 4) AI/LLM слой
- Вызов: OpenAI-совместимый HTTP API (`LlmService`); на MVP удобно `Ollama` (`/v1/chat/completions`). Абстракция нескольких провайдеров (`LLMProvider`) — целевое развитие.
- **Сборка бота:** `BOT_CONFIGURATION` → файл `config/configurations/<имя>.json` связывает идентификатор профиля промпта (`llmPromptProfile`) и путь к JSON sales-скриптов (`salesScriptsPath`). Примеры: `daria-mokko`, `test-saas`, `test-fitness`, `default`.
- Промпты: `config/prompt-profiles/<id>.json` (рамка темы, persona, цели, запреты, опционально `humanLikeMode`, `scopeFile` и др.). Сценарии воронки: JSON по пути из `salesScriptsPath` (не обязательно один общий `scripts/sales-scripts.json`).
- Защита: fallback на шаблоны скрипта, hand-off к человеку; расширенная пост-валидация ответа LLM — в планах.

## 5) Хранение данных (MVP)
- `users` — клиентские профили.
- `conversations` — диалоговые сессии.
- `messages` — история сообщений.
- `lead_states` — этапы воронки/квалификация.
- `handoff_events` — передачи менеджеру-человеку.

## 6) Базовая структура модулей
- **Фактически:** монолитный Nest-проект, `src/modules/*` (health, telegram, whatsapp, dialog, llm, prisma, idempotency, bot-configuration, prompt-profile, shared).
- **Целевое разбиение (можно эволюционно приблизить):** `apps/api` или тот же корень; `channel` — единый адаптер; `dialog`; `llm`; `crm` — лиды и метрики (пока данные в Prisma без отдельного CRM-модуля).

## 7) Минимальные npm зависимости
- `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`
- `prisma`, `@prisma/client`
- `ioredis`, `bullmq`
- `pino`, `pino-http`
- `zod` (в проекте есть; валидация JSON-конфигов при старте — рекомендуется добавить)
- Опционально: `telegraf` при переходе на него для Telegram

## 8) Нефункциональные требования
- SLA ответа бота: до 3 сек (95p на MVP).
- Идемпотентность обработки webhook событий.
- Аудит действий AI в каждом диалоге.
- Подготовка к мультиязычности (ru/en).

## 9) План внедрения стека
1. Инициализировать `NestJS` проект.
2. Поднять `PostgreSQL` и `Redis` через Docker Compose.
3. Подключить `Prisma` и первую схему БД.
4. Добавить Telegram adapter и тестовый диалог.
5. Добавить LLMProvider + системный промпт из `PROMPT_PLAN.md`.
6. Реализовать hand-off и базовые метрики.

## 10) Критерии готовности MVP
- Telegram диалог работает end-to-end.
- Сессии и история пишутся в БД.
- Скрипт продаж проходит этапы воронки.
- Есть hand-off к менеджеру-человеку.
- Есть базовые логи и метрики конверсии.
