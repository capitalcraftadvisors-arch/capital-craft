# Capital Craft backend — deploy cheatsheet

Project ref: **`hpebydmrpimyuxgsgtmu`**
Region: South Asia (Mumbai), `ap-south-1`
Stack: Supabase Postgres + Storage + Edge Functions (Deno)

> Read once. Run top to bottom. Every command is idempotent — re-running won't
> break anything.

---

## 0. One-time install

```powershell
# Supabase CLI (choose one)
scoop install supabase                  # Windows / scoop
# or
npm i -g supabase                       # any platform

# Deno (only if you want to test functions locally; not required to deploy)
irm https://deno.land/install.ps1 | iex
```

---

## 1. Link the local repo to the live project

From this directory (`D:\capital craft\capital craft backend`):

```powershell
supabase login                          # opens browser, one-time
supabase link --project-ref hpebydmrpimyuxgsgtmu
```

When prompted for the DB password, paste the one from the Supabase dashboard
(Project Settings → Database → Database password).

---

## 2. Push migrations (schema, RLS, storage, admin seed)

```powershell
supabase db push
```

That applies the four files in `supabase/migrations/` in order:

1. `0001_initial_schema.sql` — 4 tables + 5 enums + triggers
2. `0002_rls_policies.sql` — own-row + admin-all policies
3. `0003_storage_bucket.sql` — private `epc-docs` bucket + 3 policies
4. `0004_seed_admins.sql` — two admin rows (`9999900001`, `9999900002`)

> If `db push` complains the migrations are out of sync, run
> `supabase db remote commit` first to baseline the remote, then re-push.

---

## 3. Set Edge Function secrets

Copy these values from `capitalcraft-build/keys.txt`, then run once:

```powershell
supabase secrets set FIXED_OTP=1234
supabase secrets set SUPABASE_JWT_SECRET="<paste SUPABASE_JWT_SECRET>"
supabase secrets set GOOGLE_VISION_API_KEY="<paste google vision api key>"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected — do NOT set
them manually.

Sanity-check:

```powershell
supabase secrets list
```

You should see `FIXED_OTP`, `SUPABASE_JWT_SECRET`, `GOOGLE_VISION_API_KEY`.

---

## 4. Deploy the three Edge Functions

```powershell
supabase functions deploy auth
supabase functions deploy extract-cheque
supabase functions deploy store-document
```

`auth` is configured with `verify_jwt = false` in `supabase/config.toml`
because it's the login endpoint and mints the JWT itself. The other two
require a Bearer JWT.

---

## 5. Smoke test — auth login

```powershell
curl -X POST `
  "https://hpebydmrpimyuxgsgtmu.supabase.co/functions/v1/auth" `
  -H "Content-Type: application/json" `
  -d '{\"mobile\":\"9999900001\",\"otp\":\"1234\"}'
```

Expected: `{ "ok": true, "token": "eyJ...", "business": { ..., "business_type": "admin", "status": "approved" } }`.

Wrong OTP returns `{ "ok": false, "error": "invalid_otp" }` with status 401.

---

## 6. Frontend env

Once the backend is live, the frontend (separate repo, deployed to Netlify)
needs only:

```
NEXT_PUBLIC_SUPABASE_URL=https://hpebydmrpimyuxgsgtmu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste anon key from keys.txt>
NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL=https://hpebydmrpimyuxgsgtmu.supabase.co/functions/v1
```

---

## 7. Before going to production

- [ ] Replace `Access-Control-Allow-Origin: "*"` in all three Edge Functions
      with `https://app.capitalcraft.in`.
- [ ] Rotate the admin mobile numbers in `0004_seed_admins.sql` to the real
      Ops team's phones (or `update epc_business set contact_mobile = ...`).
- [ ] Set the `SUPABASE_JWT_SECRET` to whatever Supabase shows in
      Project Settings → API → JWT Secret (if it ever rotates).
- [ ] Verify the storage bucket is **private** in the dashboard
      (Storage → epc-docs → "Public: OFF").

---

## Reset / nuke (dev only)

If you want to wipe the DB during development:

```powershell
supabase db reset --linked            # drops + re-runs every migration
```

Don't run this against production — it deletes everything.
