import type { ResolvedBotConfiguration } from "../bot-configuration/bot-configuration.types";
import type { ResolvedLlmPromptProfile } from "../prompt-profile/prompt-profile.types";

/** Ресурсы бота для админского теста / предпросмотра (ещё не собранные в DialogRuntimeSnapshot). */
export interface ResolvedDialogResourceBundle {
  bot: ResolvedBotConfiguration;
  profile: ResolvedLlmPromptProfile;
}
