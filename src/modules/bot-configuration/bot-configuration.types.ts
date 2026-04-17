/** Содержимое JSON в config/configurations/<id>.json */
export interface BotConfigurationFileJson {
  /** Имя файла профиля без .json из config/prompt-profiles/ */
  llmPromptProfile?: string | null;
  /** Путь к JSON скриптов продаж относительно корня проекта */
  salesScriptsPath?: string | null;
  /** Использовать ли RAG (векторный поиск) вместо лексического поиска по базе знаний */
  useRag?: boolean | string | null;
}

export interface ResolvedBotConfiguration {
  /** Идентификатор (имя файла без .json) */
  id: string;
  llmPromptProfile: string;
  salesScriptsPath: string;
  useRag: boolean;
}
