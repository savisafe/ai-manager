# Алгоритм работы бота (Telegram / WhatsApp)

От **сообщения пользователя в мессенджере** до **ответа в том же чате**: цепочка вызовов, роль PostgreSQL и файлов конфигурации.

---

## Диаграмма последовательности

```mermaid
sequenceDiagram
  participant U as Пользователь
  participant MS as Мессенджер
  participant API as Nest webhook
  participant CH as ChannelService
  participant I as IdempotencyService
  participant D as DialogService
  participant DB as PostgreSQL
  participant L as LLM Ollama

  U->>MS: текст в чат
  MS->>API: POST webhook
  API->>CH: handleIncoming
  CH->>I: tryProcess(channel, messageId)
  I->>DB: INSERT ProcessedInboundMessage
  alt дубликат messageId
    I-->>CH: false, выход
  end
  CH->>D: process(channel, externalUserId, text)
  D->>DB: find/create User, find/create Conversation
  D->>DB: INSERT Message role=client
  Note over D: handoff, этап FSM, шаблон
  D->>DB: SELECT Message история
  D->>L: chat completions если LLM вкл. и не handoff
  L-->>D: текст или ошибка/таймаут
  D->>DB: UPDATE Conversation
  D->>DB: INSERT Message role=assistant
  D->>DB: UPSERT LeadState
  opt handoff
    D->>DB: INSERT HandoffEvent
  end
  D-->>CH: replyText
  CH->>MS: send API мессенджера
  MS->>U: ответ в чат
```

Для **Telegram**: `ChannelService` = `TelegramService`, webhook `POST /webhooks/telegram`.  
Для **WhatsApp**: `WhatsAppService`, `POST /webhooks/whatsapp` (плюс верификация GET и при необходимости подпись).

---

## Этапы по шагам

### 1. Доставка в приложение

Мессенджер отправляет **HTTP POST** на публичный URL вебхука. Контроллер передаёт тело в сервис канала (`handleIncoming`).

### 2. Извлечение сообщения

Из payload берутся текст, идентификатор пользователя в канале (например Telegram `chat.id` или WhatsApp `from`) и при наличии **id сообщения**. Некорректные апдейты отбрасываются.

### 3. Идемпотентность (БД)

`IdempotencyService.tryProcess(channel, externalMessageId)`:

- Вставка строки в **`ProcessedInboundMessage`** с уникальной парой `(channel, externalMessageId)`.
- Повтор той же пары → нарушение уникальности → **обработка не выполняется** (защита от повторной доставки webhook).

Если `messageId` нет, повторная защита по этой таблице не срабатывает (обработка идёт каждый раз).

### 4. Пользователь и активный диалог (БД)

`DialogService.process`:

1. **`User`** — поиск по `channel` + `externalId`, при отсутствии — `create` (при гонке уникальности — повторный `findFirst`). Один пользователь на пару канал + внешний id.
2. **`Conversation`** — поиск последней беседы со статусом **`ACTIVE`** для этого пользователя. Если нет — создаётся новая. Так задаётся «текущий» диалог.

### 5. Сохранение входящего сообщения (БД)

В **`Message`** создаётся запись: `role = "client"`, текст, `conversationId`.

### 6. Правила без LLM (JSON на диске)

Путь к файлу задаётся сборкой бота: **`salesScriptsPath`** в `config/configurations/<BOT_CONFIGURATION>.json` (например `scripts/daria-mokko/sales-scripts.json` или `scripts/sales-scripts.json` для конфигурации `default`). При старте приложения файл читается один раз в `DialogService`.

- **Handoff**: если текст совпал с `handoff.rules` → причина handoff, ответ из `handoff.replyLines`, **LLM не вызывается**.
- Иначе **этап воронки** (`stage`): правила `rules` (подстроки → `setStage`) и логика перехода с дефолтного этапа (например на `qualification`).
- Формируется **шаблонный ответ** для этапа — используется как текст ответа при отключённом LLM, ошибке или таймауте.

### 7. Генерация ответа: LLM или шаблон

Если **не handoff** и LLM включён (`LLM_ENABLED`):

- Из **`Message`** читается хвост истории беседы (лимит **`LLM_CONTEXT_MESSAGES`**, иначе до 16 сообщений).
- Системный промпт строится из профиля **`config/prompt-profiles/<id>.json`**, где `id` = **`llmPromptProfile`** из активной сборки `config/configurations/<BOT_CONFIGURATION>.json` (если в JSON не задан — fallback к **`LLM_PROMPT_PROFILE`**). В профиле поддерживаются расширенные поля (цели, persona, запреты, **`humanLikeMode`** и др.) — см. `PromptProfileService` / `DialogService.buildSystemPrompt`.
- Запрос к провайдеру OpenAI-совместимого API (по умолчанию **Ollama**). С **`LLM_TIMEOUT_MS`** запрос может оборваться → тогда используется **шаблон** из п.6.

При handoff или выключенном / неуспешном LLM итоговый текст — шаблон или текст handoff.

### 8. Фиксация состояния и исходящего сообщения (БД)

- **`Conversation`**: обновляются `stage`, при handoff — `status = HANDED_OFF`, иначе остаётся `ACTIVE`.
- **`Message`**: новая строка с `role = "assistant"` и итоговым текстом.
- **`LeadState`**: `upsert` — в т.ч. `need` (последний текст пользователя), `nextAction` из конфига или handoff.

При handoff дополнительно **`HandoffEvent`**: `conversationId`, `reason`.

### 9. Отправка в мессенджер

Сервис канала вызывает HTTP API мессенджера (Telegram `sendMessage`, WhatsApp Cloud API `messages`). Пользователь видит ответ в чате.

---

## Таблицы PostgreSQL (кратко)

| Таблица | Назначение |
|---------|------------|
| **User** | Участник чата: `channel` + `externalId`. |
| **Conversation** | Диалог: `stage`, `status` (`ACTIVE` / `HANDED_OFF` / `CLOSED`). |
| **Message** | История: роли `client` / `assistant`. |
| **LeadState** | Сводка по лиду: `need`, `nextAction`, поля бюджета/сроков в схеме. |
| **HandoffEvent** | Журнал передачи запроса человеку. |
| **ProcessedInboundMessage** | Идемпотентность входящих по `(channel, externalMessageId)`. |

---

## Что хранится не в БД

| Ресурс | Назначение |
|--------|------------|
| `config/configurations/*.json` | Сборка: какой **`llmPromptProfile`** и какой **`salesScriptsPath`** использовать (`BOT_CONFIGURATION` в `.env`). |
| JSON по пути `salesScriptsPath` | Этапы, шаблоны реплик, правила переходов и handoff (часто `scripts/.../sales-scripts.json`). |
| `config/prompt-profiles/*.json` | Рамка LLM: компания, тема, запреты, persona, цели, `humanLikeMode`, опциональный `scopeFile` и др. |
| Ollama / внешний LLM | Инференс; параметры — переменные окружения (`LLM_*`). |

---

## Связанный код (ориентиры)

- Webhook Telegram: `src/modules/telegram/telegram.controller.ts`, `telegram.service.ts`
- Webhook WhatsApp: `src/modules/whatsapp/whatsapp.controller.ts`, `whatsapp.service.ts`
- Диалог и БД: `src/modules/dialog/dialog.service.ts`
- Идемпотентность: `src/modules/idempotency/idempotency.service.ts`
- LLM: `src/modules/llm/llm.service.ts`
- Профиль промпта: `src/modules/prompt-profile/prompt-profile.service.ts`
- Сборка бота (пути к профилю и скриптам): `src/modules/bot-configuration/bot-configuration.service.ts`
- Схема БД: `prisma/schema.prisma`
