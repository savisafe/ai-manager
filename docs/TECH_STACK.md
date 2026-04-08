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
- Cache/Queue: `Redis` + `BullMQ`
- Logging: `Pino`
- Errors/Observability: `Sentry` (опционально на MVP)
- Containerization: `Docker` + `Docker Compose`

## 3) Канальные интеграции
### Telegram
- `Telegraf` или прямой Telegram Bot API через NestJS adapter.
- Режимы: webhook (prod), polling (local dev).

### WhatsApp
- BSP-провайдер через официальный WhatsApp Business API (рекомендуется `360dialog`).
- Входящие/исходящие события через webhook.

### Другие каналы
- Подключаются через общий интерфейс `ChannelAdapter`.
- Единая модель входящих сообщений и метаданных.

## 4) AI/LLM слой
- Провайдер: `OpenAI API` (через абстракцию `LLMProvider`).
- Промпты и сценарии: в versioned md/json конфигурации.
- Защита: валидация ответов, fallback-шаблоны, hand-off к человеку.

## 5) Хранение данных (MVP)
- `users` — клиентские профили.
- `conversations` — диалоговые сессии.
- `messages` — история сообщений.
- `lead_states` — этапы воронки/квалификация.
- `handoff_events` — передачи менеджеру-человеку.

## 6) Базовая структура модулей
- `apps/api` — вебхуки, REST, healthcheck.
- `modules/channel` — адаптеры Telegram/WhatsApp.
- `modules/dialog` — FSM и сценарии продаж.
- `modules/llm` — генерация ответов и guardrails.
- `modules/crm` — лиды, статусы, метрики.
- `modules/shared` — типы, utils, конфиг.

## 7) Минимальные npm зависимости
- `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`
- `telegraf`
- `prisma`, `@prisma/client`
- `ioredis`, `bullmq`
- `pino`, `pino-http`
- `zod` (валидация данных и конфигов)

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
