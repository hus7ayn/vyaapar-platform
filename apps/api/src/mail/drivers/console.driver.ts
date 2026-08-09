import { Logger } from '@nestjs/common';
import { MailDriver, MailMessage } from '../mail.types';

/**
 * The default driver. Prints the message instead of sending it, so an environment with no mail
 * provider configured behaves exactly as the system did before mail existed — nothing breaks by
 * deploying this, it just doesn't deliver.
 */
export class ConsoleMailDriver implements MailDriver {
  readonly name = 'console';
  private readonly logger = new Logger('Mail');

  async send(message: MailMessage): Promise<void> {
    this.logger.log(
      [
        '',
        '──────── email (not sent — MAIL_DRIVER=console) ────────',
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
        '────────────────────────────────────────────────────────',
      ].join('\n'),
    );
  }
}
