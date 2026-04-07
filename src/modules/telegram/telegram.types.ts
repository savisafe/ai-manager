export interface TelegramWebhookPayload {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: {
      id?: number;
      type?: string;
    };
    from?: {
      id?: number;
      first_name?: string;
      username?: string;
    };
  };
}

export interface IncomingTelegramMessage {
  chatId: number;
  text: string;
  messageId?: number;
}
