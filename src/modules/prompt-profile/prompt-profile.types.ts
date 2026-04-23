export interface ResolvedLlmPromptProfile {
  /** Имя файла профиля (без .json) */
  id: string;
  companyName: string;
  /** Заменяет стандартное «Ты — AI-менеджер компании …», если задано */
  persona?: string;
  /** Язык ответов по умолчанию (подсказка в системном промпте) */
  language?: string;
  /** Цели диалога в чате */
  primaryGoals?: string[];
  topic?: string;
  /** Кратко: что продаём / на что вести разговор */
  servicesHighlight?: string;
  forbiddenTopics: string[];
  /** Доп. жёсткие запреты (поведение, обещания) */
  neverDo?: string[];
  /** Как вести к записи / контакту; без выдуманных телефонов и цен */
  bookingAndContact?: string;
  /** Дополнительные пункты к блоку «Правила стиля и продаж» */
  additionalStyleRules?: string[];
  /** Более живой, разговорный тон (без потери деловитости и рамки темы) */
  humanLikeMode?: boolean;
  /** Без ограничения темы и без промптов воронки продаж — общий ассистент */
  openTopicsMode?: boolean;
  /** Текст из scopeFile, если задан и файл прочитан */
  scopeText?: string;
  /** Строгий режим: отвечать только по найденным фрагментам базы знаний */
  strictKnowledgeMode?: boolean;
  /** Сообщение при отсутствии релевантной информации в базе знаний */
  noKnowledgeReply?: string;
  /** Размер чанка для простого retrieval */
  retrievalChunkSize?: number;
  /** Перекрытие между соседними чанками */
  retrievalChunkOverlap?: number;
  /** Максимум чанков, добавляемых в контекст ответа */
  retrievalTopK?: number;
  /**
   * В strictKnowledgeMode: сообщения, совпавшие с одним из regex, идут в LLM без раннего noKnowledgeReply
   * (при отсутствии фрагментов БЗ). Паттерны — строки RegExp с флагом `u` на стороне рантайма.
   */
  strictKnowledgeConversationalBypass?: {
    maxMessageLength: number;
    patterns: RegExp[];
  };
  /** Строки, добавляемые к system prompt при conversational bypass; если не задано — дефолт из кода профиля */
  strictKnowledgeConversationalPromptAddendumLines?: string[];
}

export interface PromptProfileFileJson {
  companyName?: string;
  persona?: string | null;
  language?: string | null;
  primaryGoals?: string[];
  topic?: string | null;
  servicesHighlight?: string | null;
  forbiddenTopics?: string[];
  neverDo?: string[];
  bookingAndContact?: string | null;
  additionalStyleRules?: string[];
  /** true / "true" в JSON — удобно при ручном редактировании */
  humanLikeMode?: boolean | string;
  openTopicsMode?: boolean | string;
  /** Для записей из БД: сырое тело базы знаний без scopeFile */
  scopeText?: string | null;
  scopeFile?: string | null;
  strictKnowledgeMode?: boolean | string;
  noKnowledgeReply?: string | null;
  retrievalChunkSize?: number | string | null;
  retrievalChunkOverlap?: number | string | null;
  retrievalTopK?: number | string | null;
  /**
   * Регулярки (строки без обрамления /.../): при strictKnowledgeMode переопределяют дефолтные паттерны.
   * Пустой массив — отключить обход (всегда noKnowledgeReply при пустом контексте).
   */
  strictKnowledgeConversationalBypass?: {
    maxMessageLength?: number | string | null;
    patterns?: string[] | null;
  } | null;
  /** Кастомный текст к system prompt при обходе; пустой массив — без доп. блока */
  strictKnowledgeConversationalPromptAddendum?: string[] | null;
}
