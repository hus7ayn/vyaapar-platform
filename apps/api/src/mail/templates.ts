import { MailBody } from './mail.types';

const BRAND = 'hsl(348, 85%, 52%)';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Shared chrome so both mails look like the same product. */
function layout(bodyHtml: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#eceef1;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1b1f">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:32px 34px">
    <div style="font-weight:800;font-size:21px;color:${BRAND};margin-bottom:26px">Vyaapar</div>
    ${bodyHtml}
  </div>
</body></html>`;
}

/**
 * The six-digit reset code. The business name is not decoration: one address can own accounts in
 * two businesses, in which case two of these arrive at once and the name is the only way to tell
 * them apart.
 */
export function resetCodeEmail(input: {
  firstName: string;
  businessName: string;
  code: string;
  expiresInMinutes: number;
}): MailBody {
  const { firstName, businessName, code, expiresInMinutes } = input;

  const text = [
    `Hello ${firstName},`,
    '',
    `Here is your password reset code for ${businessName}:`,
    '',
    `    ${code}`,
    '',
    `It expires in ${expiresInMinutes} minutes and can be used once.`,
    '',
    "Didn't ask for this? Someone typed your address on the login screen. Your password has not",
    'changed and nothing happens unless this code is used.',
    '',
    'Vyaapar',
  ].join('\n');

  const html = layout(`
    <h1 style="font-size:20px;margin:0 0 14px">Your reset code</h1>
    <p style="margin:0 0 15px;font-size:14.5px">
      Hello ${escapeHtml(firstName)}, enter this on the reset screen to choose a new password for
      <strong>${escapeHtml(businessName)}</strong>:
    </p>
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;font-weight:800;
                letter-spacing:.16em;text-align:center;padding:18px;background:#f9fafb;
                border:1px solid #e5e7eb;border-radius:9px;margin:4px 0 18px">${escapeHtml(code)}</div>
    <p style="margin:0 0 15px;font-size:14.5px">It expires in ${expiresInMinutes} minutes and can be used once.</p>
    <div style="margin-top:26px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12.5px;color:#6b7280">
      Didn't ask for this? Someone typed your address on the login screen. Your password has not
      changed and nothing happens unless this code is used.
    </div>`);

  return { subject: `Your Vyaapar reset code: ${code}`, html, text };
}

/** Confirms that the recovery address actually reaches the owner. */
export function verifyAddressEmail(input: {
  firstName: string;
  businessName: string;
  link: string;
  expiresInHours: number;
}): MailBody {
  const { firstName, businessName, link, expiresInHours } = input;

  const text = [
    `Hello ${firstName},`,
    '',
    `You're the Super Admin for ${businessName}. This inbox is the only thing that can unlock`,
    'your account if you ever forget your password — so let\'s make sure it reaches you.',
    '',
    'Confirm this address:',
    link,
    '',
    `The link works for ${expiresInHours} hours. Vyaapar keeps working normally in the meantime.`,
    '',
    'Vyaapar',
  ].join('\n');

  const html = layout(`
    <h1 style="font-size:20px;margin:0 0 14px">Hello ${escapeHtml(firstName)},</h1>
    <p style="margin:0 0 15px;font-size:14.5px">
      You're the Super Admin for <strong>${escapeHtml(businessName)}</strong>. This inbox is the
      only thing that can unlock your account if you ever forget your password — so let's make
      sure it reaches you.
    </p>
    <a href="${escapeHtml(link)}" style="display:inline-block;background:${BRAND};color:#fff;
       text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:8px;
       margin:8px 0 18px">Confirm this address</a>
    <p style="font-size:12.5px;color:#6b7280;word-break:break-all;background:#f9fafb;
              border:1px solid #e5e7eb;border-radius:7px;padding:11px 13px">
      Or paste this into your browser:<br>${escapeHtml(link)}
    </p>
    <p style="margin:0 0 15px;font-size:14.5px">
      The link works for ${expiresInHours} hours. Vyaapar keeps working normally in the meantime.
    </p>
    <div style="margin-top:26px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12.5px;color:#6b7280">
      Didn't expect this? Someone may have typed your address by mistake. Ignore this email and
      nothing will change.
    </div>`);

  return { subject: `Confirm your recovery email for ${businessName}`, html, text };
}
