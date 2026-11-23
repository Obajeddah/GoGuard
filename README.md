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
4. **Build and deploy.** `bun run build`. The current Vite/Nitro configuration targets Cloudflare Workers; use a compatible Workers deployment. A Node host is not a drop-in target: change the deployment preset and validate its generated start command first. Set server variables in the host's secret configuration, not just the browser build environment.
5. **Payments.** In Paystack, set the webhook URL to `https://<your-domain>/api/public/paystack-webhook`.

6. **Data move.** Source code is not a database or photo backup. Export/import your school data separately, transfer the private `photos` objects without changing their paths, and arrange an auth-user migration or password reset. Point the deployed code at the new backend only after checks pass.
7. **Email.** Email setup is separate. The currently documented managed email service needs a verified domain and server API key; if replacing it, wire the replacement provider into the existing notification rules. A code export alone does not migrate an email domain or delivery setup.

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
