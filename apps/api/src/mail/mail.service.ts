import { Injectable, Logger } from '@nestjs/common';
import { ConsoleMailDriver } from './drivers/console.driver';
import { HttpMailDriver } from './drivers/http.driver';
import { MailDriver, MailMessage } from './mail.types';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly driver: MailDriver;

  constructor() {
    this.driver = MailService.resolveDriver();
    this.logger.log(`Mail driver: ${this.driver.name}`);
  }

  get driverName(): string {
    return this.driver.name;
  }

  /**
   * Never rejects. A bounced message must not fail the request that triggered it — on
   * forgot-password that would turn the HTTP response into an oracle for which addresses exist,
   * which is the whole thing the generic reply is there to prevent.
   */
  async send(message: MailMessage): Promise<void> {
    try {
      await this.driver.send(message);
    } catch (error) {
      this.logger.error(
        `Could not deliver "${message.subject}" to ${message.to}: ${(error as Error).message}`,
      );
    }
  }

  /** `console` unless a driver is named AND fully configured — a half-set provider must not fail closed. */
  private static resolveDriver(): MailDriver {
    const requested = (process.env.MAIL_DRIVER || 'console').trim().toLowerCase();
    if (requested === 'console') return new ConsoleMailDriver();

    const apiKey = process.env.MAIL_API_KEY;
    const from = process.env.MAIL_FROM;
    if (!apiKey || !from) {
      new Logger(MailService.name).warn(
        `MAIL_DRIVER=${requested} but MAIL_API_KEY/MAIL_FROM are missing — falling back to console.`,
      );
      return new ConsoleMailDriver();
    }
    return new HttpMailDriver(apiKey, from);
  }
}
