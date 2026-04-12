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
  /** Текст из scopeFile, если задан и файл прочитан */
  scopeText?: string;
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
  scopeFile?: string | null;
}
