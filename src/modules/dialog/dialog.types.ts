export type ChannelType = "telegram" | "whatsapp";

export interface DialogInput {
  channel: ChannelType;
  externalUserId: string;
  text: string;
}

export interface DialogOutput {
  replyText: string;
  stage: string;
}
