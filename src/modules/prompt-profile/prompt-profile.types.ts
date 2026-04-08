export interface ResolvedLlmPromptProfile {
  /** Имя файла профиля (без .json) */
  id: string;
  companyName: string;
  topic?: string;
  forbiddenTopics: string[];
  /** Текст из scopeFile, если задан и файл прочитан */
  scopeText?: string;
}

export interface PromptProfileFileJson {
  companyName?: string;
  topic?: string | null;
  forbiddenTopics?: string[];
  scopeFile?: string | null;
}
