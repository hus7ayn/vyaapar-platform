# Product: Account recovery — Super Admin self-reset, staff reset by the owner

## Problem

From the shop owner, locked out of the account that owns everything:

> "I forgot my password. The screen told me a code had been sent, so I waited. Nothing came. I
> asked for another one. Still nothing. I own this shop and I could not get into my own books —
> and there was nobody above me to ask."

From a cashier:

> "I forgot mine too. I told the owner. He couldn't do anything about it either, so I just used
> his login for the rest of the week."

Two separate failures. The owner has a recovery flow that silently goes nowhere — the code is
written to the server's log and never leaves the machine. Staff have no recovery flow at all, so
every forgotten password becomes a borrowed owner login, which quietly undoes the point of giving
each person their own account.

These need different answers, because the two people are in different positions. The owner has
nobody above them, so the system itself has to let them back in. Staff do have somebody above
them, so the owner should simply set their password — no code, no email, no waiting.

## Success metric

**Every lockout is resolved inside the app, by the shop itself, with nobody touching the database
— target 100%.**

Today it is effectively 0%. The owner's only route is a shared per-role key kept in server
configuration, which in practice means phoning whoever set the system up; staff have no route at
all. Measured as: lockout reports that end in a working login without a developer being involved.

Supporting number worth watching: median time from a staff member saying "I'm locked out" to that
person being back in — the target is under five minutes, since the owner is standing right there.

## Announcement — the blog post before the feature

**Nobody stays locked out.**

If you're the shop's Super Admin and you forget your password, ask for a reset on the login screen
— a six-digit code now genuinely arrives in your inbox within a minute. Type it in, choose a new
password, and you're back in your books. Because that inbox is the only key to the whole shop, we
now confirm it's real and reachable, and we'll remind you until it is. For everyone else on the
counter there's something faster than email: the Super Admin sets a new password for them straight
from the Users screen, and they're billing again in under a minute. No more sharing one login.

## Screens

- `mockups/forgot-password.html` — the Super Admin asking for a reset code, and what staff are told
- `mockups/enter-code.html` — entering the six-digit code and choosing a new password
- `mockups/verification-banner.html` — the reminder to confirm the recovery address, Super Admin only
- `mockups/verification-email.html` — the confirmation email sent to the Super Admin's address
- `mockups/owner-reset.html` — the Super Admin setting a staff member's password from Users

## Decisions taken at this gate

1. **Only the Super Admin can use forgot-password**, and the code goes to the email address on
   that Super Admin account. No other role gets a self-service reset.
2. **Staff are reset by the Super Admin**, in the app, from the Users screen. Faster than email
   and it works with the internet down.
3. **Email only**, for the one address it now matters for. No per-message cost and no provider
   registration in the way; SMS and WhatsApp both need an Indian provider plus template approval
   measured in days.
4. **Address confirmation narrows to the Super Admin.** Staff addresses are now just a label —
   nothing is ever sent to them, so there is nothing to verify. Only the address that can unlock
   the shop gets confirmed.
5. **Nag, never block.** An unconfirmed Super Admin address shows a banner and nothing else. A
   shop has to be able to bill today.
6. **The login screen never reveals who the Super Admin is.** Whatever address is typed, the reply
   reads the same: if that address can recover its own account, a code is on its way — otherwise,
   ask your Super Admin. The rule itself is stated openly; which address it applies to is not.
7. **The shared per-role reset key is retired.** It never rotates and is identical for everyone in
   a role. Decisions 1 and 2 replace it.

## The risk this design carries

Concentrating recovery on one mailbox makes that mailbox a single point of failure. If the Super
Admin's address is wrong, or that person leaves the business, nothing in the app can recover the
account that owns the shop — it becomes a developer touching the database, which is exactly the
outcome the success metric above is meant to eliminate.

That is the reason decision 4 confirms the Super Admin's address rather than treating it as a
label, and the reason the banner keeps nagging until it's done. Worth revisiting later, but not
worth widening this feature for now:

- letting the Super Admin nominate a second recovery address;
- warning loudly, and re-confirming, whenever the Super Admin's own address is changed.

## Open question for Gate 2

Whether an **Admin** (not just the Super Admin) may set a Biller's password. Assumed **no** for
now — recovery stays with the Super Admin, matching decision 1. Say the word if an Admin managing
counter staff should be able to do it, since it changes who holds the keys.
