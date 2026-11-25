<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Architecture rules

- Tenancy: every org-owned table carries `org_id`; RLS scopes reads/writes via `get_user_org_id(auth.uid())` and `has_role()` — never trust a client-sent org id.
- Roles live in `public.user_roles` (admin | guard | driver | attendant), never on profiles. Org + admin rows are created by the `handle_new_org_admin` auth trigger, which also re-enforces the school-domain email rule.
- Anonymous flows (parent registration, guardian pass page) go through public server functions in `src/lib/registration.functions.ts`; they validate the link token / 64-char pass hash before using the privileged client.
- Guardian/member photos live in the private `photos` bucket under `<org_id>/<member_id>/...`; the app always shows them via signed URLs.
- Gate check-in/out is recorded by the `recordGateAction` server function so email notifications can be sent server-side; recipient rules live in `src/lib/notification-recipients.ts` (tested).
- Org-type wording (student/resident/employee etc.) comes from `src/lib/org-terms.ts`; don't hardcode school terms in shared UI.
- Role capabilities (which pages and admin actions each role gets) live in `src/lib/access.ts` (tested); UI gates use `pagesFor`/`can`, and RLS enforces the same split server-side.
- Public sign-up creates school organisations only (`TYPE` in `src/routes/signup.tsx`); estate/corporate stay in the schema and `org-terms` so they can be re-enabled without migrations.
- Billing rules (prices, trial length, what pauses when unpaid, how a payment extends `paid_until`) live in `src/lib/billing.ts` (tested); `organizations.trial_ends_at` / `paid_until` / `transport_paid_until` are written only by the database default and server-side payment settlement (service role), never by clients. Server-side email sending must check `billingState(org).canSendEmails`.
- Payments use Paystack one-off charges per period (not Paystack subscriptions) so bank transfer and USSD work. `startCheckout` creates a pending `payments` row; `settlePayment` in `src/lib/paystack.server.ts` is the only settlement path, called by the signed webhook (`/api/public/paystack-webhook`) and the `/payment` return page, and is idempotent per reference.
- Data lives in plain PostgreSQL (schema in `drizzle/migrations`) so the app can be self-hosted later; avoid backend-proprietary features where a portable SQL equivalent exists.
- "Keep me signed in" rules (how long a sign-in lasts) live in `src/lib/remember-me.ts` (tested) and are enforced client-side at app start in `__root.tsx`; the generated auth client and `_authenticated` layout stay untouched.
- School classes live in `organizations.classes` (ordered list); a student's class is stored in `members.identifier_code`. Class rules (allowed class, grouping order) and duplicate-name detection live in `src/lib/classes.ts` (tested); the public registration function rejects classes the school did not tick.
- QR passes are bound to their data by the `guardians_pass_binding` trigger: the database always generates the code, ignores client-set codes, and issues a new one when the guardian's child, name or an existing photo changes. Scanners validate with `checkPass` in `src/lib/pass-check.ts` (tested) against the signed-in school and expected child.
- `.env.example` lists every environment variable name for self-hosting; never put real values in it.
- Transport (Fleet, bus app, bus pupils, ride notices) needs `transport_enabled` plus an active transport entitlement, enforced by triggers; attendance is derived from gate and bus logs, never marked by hand. Details in `src/lib/AGENTS.md`.
- Subdirectories may have their own `AGENTS.md`; read it before changing files there.
- Both scanner routes render `src/components/gate-scanner.tsx` so guard sign-in and dashboard scanning share the same verification flow.
- Team and Settings share `src/components/gate-staff.tsx`; Team renders staff controls directly so its URL stays a distinct page.
- Public plan comparisons read prices and limits from `src/lib/billing.ts` so pricing displays follow the billing rules.
- Signup carries a single-use captcha ticket into auth metadata and fails closed without both Turnstile keys, so direct signup cannot bypass verification.
- Paystack settlement calls one service-only PostgreSQL function that locks payment and school rows; entitlement and payment status commit together and retries never extend twice.
- Directory and gate reports use `readAll` with stable ordering and branch-scoped query keys, so exports are complete and branch switching does not reuse another branch's results.
- Student detail edits use `edit_member` with its server-side PIN check; never compare PINs locally or directly update protected detail fields.
