import { MailDriver, MailMessage } from '../mail.types';

const DEFAULT_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Sends over the provider's HTTPS API rather than SMTP: the API runs as a single Vercel
 * serverless function, where a short request fits the budget and a held-open SMTP socket
 * does not.
 *
 * The body shape below is Resend's, which Postmark and others accept near-identically;
 * MAIL_API_URL retargets it without a code change.
 */
export class HttpMailDriver implements MailDriver {
  readonly name = 'http';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly endpoint: string = process.env.MAIL_API_URL || DEFAULT_ENDPOINT,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      // Well under the platform's request budget: a slow provider must not hold a user's
      // password reset open until the function itself is killed.
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Mail provider rejected the message (${res.status}) ${detail}`.trim());
    }
  }
}
