# Contact encryption

Parent, guardian and school phone numbers and email addresses are encrypted
before they are stored. The database holds AES-256-GCM ciphertext plus a
one-way index used for lookups. The key exists only in the server environment.

## What is stored where

| Data | Column | Also stored |
| --- | --- | --- |
| Parent email | `members.primary_email_enc` | `members.parent_email_hash` |
| Parent phone | `members.primary_phone_enc` | none |
| Guardian email | `guardians.email_enc` | `guardians.email_hash` |
| School emergency line | `organizations.emergency_phone_enc` | none |
| Delivery log address | `email_deliveries.email` (holds the index, not the address) | none |

The old plaintext columns (`members.primary_email`, `members.primary_phone`,
`guardians.email`, `guardians.phone`, `organizations.emergency_phone`) stay in
the schema but are emptied and are not readable by a signed-in school account.
They are kept only so older database functions do not break.

**Not encrypted, by design:** `profiles.email` and `organizations.admin_email`
are the sign-in identity managed by Supabase Auth; encrypting them would break
login and password reset. Bus crew numbers (`buses.driver_phone`,
`buses.attendant_phone`) are operational staff contacts and are still plaintext.

## Ciphertext format

```
v1.<iv base64url>.<tag base64url>.<ciphertext base64url>
```

* AES-256-GCM, a fresh 12-byte IV per value, 16-byte tag.
* Additional authenticated data is the field name (`member.email`,
  `guardian.email`, `org.emergency_phone`, `member.phone`), so a value cannot be
  moved from one field to another and still decrypt.
* A value with no `v1.` prefix is read as legacy plaintext, which is what lets
  the app keep working while the backfill runs.

## Blind index

`HMAC-SHA256(email, HKDF(master key, "blind-index"))`, hex, lower-cased address.
It makes "does this address already belong to someone" and "find this family's
other children" possible without storing the address. It is one-way, but it is
deterministic: someone with the key can confirm whether a guessed address is
present. Rotating the key re-computes every index, so duplicate-send protection
starts fresh once.

## Key management

Generate once:

```sh
openssl rand -base64 32
```

Set `CONTACT_ENCRYPTION_KEY` in the server environment (Netlify: Site
configuration → Environment variables). Never put it in the repository, the
client bundle, or a database row. If it is missing the app refuses to save or
read contact details rather than storing something it cannot decrypt.

Rotation:

1. Generate a new key.
2. Put the old key in `CONTACT_ENCRYPTION_KEY_PREVIOUS` and the new one in
   `CONTACT_ENCRYPTION_KEY`.
3. Deploy. Reads now try the new key, then the old one.
4. Re-encrypt existing rows with a one-off script (read with the old key, write
   with the new).
5. Remove `CONTACT_ENCRYPTION_KEY_PREVIOUS` and deploy again.

Losing the key means the stored addresses cannot be recovered. The rest of the
school record (names, classes, passes, logs) is unaffected, but parent email
notifications stop until families re-enter an address.

## Rollout order

This is a two-step migration because the app and the database must not disagree
about where an address lives.

1. **Apply** `supabase/contact-encryption-1-add.sql` in the Supabase SQL editor.
   It only adds columns and the new edit function. The running app is unaffected.
2. **Set** `CONTACT_ENCRYPTION_KEY` in the server environment.
3. **Deploy** the app. It writes ciphertext and reads ciphertext, falling back to
   legacy plaintext for rows not yet migrated.
4. **Backfill**:

   ```sh
   CONTACT_ENCRYPTION_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
     node scripts/encrypt-contacts.mjs --verify
   ```

   Re-run until it reports no failures. `--verify` confirms the ciphertext
   decrypts with the deployed key.
5. **Apply** `supabase/contact-encryption-2-finalize.sql`. It empties the
   plaintext columns, revokes them from school accounts, and points the
   registration link at the encrypted emergency line.
6. **Check**: register a test family, confirm the pass email arrives, scan a
   pass once, change a student's details with the edit code, and save the
   emergency line in Settings.

## When email still works

Every send path reads the encrypted column with the service-role client and
decrypts on the server immediately before handing the message to the mail
provider. Nothing is decrypted in the browser. The registration page, parent
app, bus tracking page and gate scanner receive only the school's decrypted
emergency line, which is the number they are meant to call.

The duplicate-send guard compares blind indexes, so it still works without
storing addresses.
