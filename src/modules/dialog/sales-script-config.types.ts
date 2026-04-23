export interface SalesRule {
  containsAny: string[];
  setStage: string;
}

export interface HandoffRule {
  containsAny: string[];
  reason: string;
}

export interface StageConfig {
  replyLines: string[];
}

export interface HandoffConfig {
  nextAction: string;
  replyLines: string[];
  handOffTriggers: HandoffRule[];
}

export interface SalesScriptsConfig {
  defaultStage: string;
  nextAction: string;
  handoff?: HandoffConfig;
  stages: Record<string, StageConfig>;
  rules: SalesRule[];
}
