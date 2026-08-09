import { ConsoleMailDriver } from '../src/mail/drivers/console.driver';
import { MailService } from '../src/mail/mail.service';
import { resetCodeEmail, verifyAddressEmail } from '../src/mail/templates';

describe('reset code email', () => {
  const build = () =>
    resetCodeEmail({
      firstName: 'Rakesh',
      businessName: 'Grand Plaza',
      code: '418290',
      expiresInMinutes: 10,
    });

  it('carries the code in the HTML and the plaintext part', () => {
    // A text-only client has to be usable — an HTML-only code is unreadable to it.
    const mail = build();
    expect(mail.html).toContain('418290');
    expect(mail.text).toContain('418290');
    expect(mail.subject).toContain('418290');
  });

  it('names the business', () => {
    // One address can own accounts in two businesses, so two of these arrive at once and the
    // name is the only thing that tells them apart.
    const mail = build();
    expect(mail.html).toContain('Grand Plaza');
    expect(mail.text).toContain('Grand Plaza');
  });

  it('states how long the code lasts', () => {
    expect(build().text).toContain('10 minutes');
  });

  it('escapes HTML in the values it interpolates', () => {
    const mail = resetCodeEmail({
      firstName: '<script>alert(1)</script>',
      businessName: 'Grand & Plaza',
      code: '000111',
      expiresInMinutes: 10,
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('Grand &amp; Plaza');
  });
});

describe('verify address email', () => {
  const link = 'https://shop.vyaapar.app/verify-email?token=abc123def456';
  const build = () =>
    verifyAddressEmail({
      firstName: 'Rakesh',
      businessName: 'Grand Plaza',
      link,
      expiresInHours: 24,
    });

  it('embeds the link verbatim in both parts', () => {
    // A mangled link is the one failure the recipient cannot work around.
    const mail = build();
    expect(mail.text).toContain(link);
    expect(mail.html).toContain(link);
  });

  it('names the business in the subject', () => {
    expect(build().subject).toContain('Grand Plaza');
  });
});

describe('MailService driver selection', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to the console driver when MAIL_DRIVER is unset', () => {
    delete process.env.MAIL_DRIVER;
    expect(new MailService().driverName).toBe('console');
  });

  it('falls back to console when a provider is named but not configured', () => {
    // A half-configured provider must not fail closed and take password reset down with it.
    process.env.MAIL_DRIVER = 'http';
    delete process.env.MAIL_API_KEY;
    delete process.env.MAIL_FROM;
    expect(new MailService().driverName).toBe('console');
  });

  it('uses the HTTP driver once the key and sender are both present', () => {
    process.env.MAIL_DRIVER = 'http';
    process.env.MAIL_API_KEY = 'test-key';
    process.env.MAIL_FROM = 'no-reply@vyaapar.app';
    expect(new MailService().driverName).toBe('http');
  });

  it('resolves even when the driver throws', async () => {
    // Delivery failure must never fail the request: on forgot-password that would turn the
    // HTTP response into an oracle for which addresses exist.
    const service = new MailService();
    jest
      .spyOn(ConsoleMailDriver.prototype, 'send')
      .mockRejectedValueOnce(new Error('provider exploded'));

    await expect(
      service.send({ to: 'a@b.com', subject: 's', html: '<p>h</p>', text: 't' }),
    ).resolves.toBeUndefined();
  });
});
