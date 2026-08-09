export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Everything about a mail except who it goes to — what a template returns. */
export type MailBody = Omit<MailMessage, 'to'>;

export interface MailDriver {
  readonly name: string;
  send(message: MailMessage): Promise<void>;
}
