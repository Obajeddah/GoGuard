# GoGuard

Safe school drop-off and pick-up: verified guardians, QR gate passes, instant parent alerts, school buses and automatic class attendance.

Built with TanStack Start, React, TypeScript and Tailwind CSS. Data lives in PostgreSQL.

## Run locally

You need [Bun](https://bun.sh) (or Node.js 20+).

```sh
git clone <this-repository-url>
cd <repository-name>
bun install
cp .env.example .env   # then fill in the values
bun run dev
```

## Hosting it yourself

1. **Database and sign-in.** GoGuard uses the official Supabase client with standard PostgreSQL, auth and storage APIs. Create your own Supabase project or self-hosted stack. Apply every SQL file in `drizzle/migrations/` in filename order, including grants, policies, triggers and functions. Do this first on an empty staging database; do not replay migrations over an existing production schema.
2. **Storage.** Create a private bucket named `photos`.
3. **Settings.** Fill in `.env` from `.env.example` using the new backend's values. Browser and server URLs must refer to the same backend. Keep email confirmation enabled and enable TOTP MFA. Add your deployed `/auth` and `/reset-password` URLs to the auth redirect allowlist. Create a Cloudflare Turnstile widget for your deployed domains and set both Turnstile variables; signup intentionally stops without them. Never expose server secrets using a `VITE_` prefix.
4. **Build and deploy.** `bun run build`. The included `vite.config.ts` and `netlify.toml` target Netlify Functions via the official TanStack Start plugin; the SSR handler is emitted at `.netlify/v1/functions/server.mjs` and static assets at `dist/client`. Set server variables in the host's secret configuration, not just the browser build environment.
5. **Payments.** In Paystack, set the webhook URL to `https://<your-domain>/api/public/paystack-webhook`.

6. **Data move.** Source code is not a database or photo backup. Export/import your school data separately, transfer the private `photos` objects without changing their paths, and arrange an auth-user migration or password reset. Point the deployed code at the new backend only after checks pass.
7. **Email.** Set `EMAIL_FROM` to a verified sender domain and either `RESEND_API_KEY` or `EMAIL_API_URL` (+ optional `EMAIL_API_KEY`). Then schedule `POST /api/cron/send-emails` with `Authorization: Bearer $LOVABLE_CRON_SECRET` (e.g. a Netlify scheduled function or external cron). The drain re-checks billing on every run and will not email for lapsed schools. Gate scans, bus notices and bus emergencies are delivered idempotently; signup/password-reset mail still comes from your auth provider.

8. **Contact encryption.** Parent, guardian and school contact details are encrypted before they are stored. Set `CONTACT_ENCRYPTION_KEY` (`openssl rand -base64 32`) on the server, then follow `docs/contact-encryption.md` for the two-step migration and backfill. Without the key the app refuses to save or read contact details instead of storing them in plain text.

### Clean-install checklist

- Migrations finish on empty staging with no missing extension/function errors.
- A real school-domain signup passes Turnstile, receives verification and enrolls an authenticator.
- Separate schools cannot read each other's records; branch staff see only their own branch.
- A parent registers via one branch link; guardian photos remain private and signed URLs work.
- A student edit accepts the correct four-digit code and rejects a wrong one.
- Gate/bus actions produce attendance; Excel contains all classes and more than 1,000 test records.
- Each bus login controls only its own bus; admins request location but never upload their own.
- Use Paystack test mode on staging to verify payment access, webhook retries and duplicate-reference idempotency before switching to live.

This checklist requires an empty staging backend and its credentials; no clean-install rehearsal or real charge is implied by the source being exported.

## Tests

```sh
bunx vitest run
```
