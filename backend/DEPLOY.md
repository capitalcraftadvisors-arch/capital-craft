# Backend — Supabase

- **PROD** project: `hpebydmrpimyuxgsgtmu` (Mumbai, `ap-south-1`), on the Free plan.
- **TEST**: a separate project, used by local runs.
- Postgres with row-level security, plus Edge Functions (Deno). Documents are
  stored in Google Cloud Storage, not in Supabase Storage (see `admin/ARCHITECTURE.md`).

## Migrations — `supabase/migrations/`

The files are numbered (`0001_…`, `0002_…` …). Each one runs **once, in order**,
against PROD. Apply a new file one of two ways:

- paste it into the dashboard SQL editor, or
- run it over a direct database connection (session pooler).

**Never run `supabase db push` or `supabase db reset`.** The CLI's migration
history does not match this folder, so it would try to re-run everything from
`0001`.

Rules for a new migration:
- Make it safe to run twice: `if not exists`, `create or replace`, and
  `drop policy if exists` before `create policy`.
- Apply it **before** deploying any app code that reads the new columns. If
  old and new code have to run side by side, use `admin/src/lib/optional-column.ts`.

## Edge Functions — `supabase/functions/`

| Function | What it does | Login needed |
|---|---|---|
| `auth` | Login: checks the mobile (plus a password where one is set) and signs the ES256 token | no (`verify_jwt = false`; it is the login) |
| `extract-pan` | reads a PAN card (Google Vision) | yes |
| `extract-cheque` | reads a cancelled cheque | yes |
| `extract-gst-legalname` | reads the legal name from a GST certificate | yes |
| `extract-gst-r3b` | reads a GSTR-3B return | yes |

To deploy one function:

```powershell
supabase functions deploy <name> --project-ref hpebydmrpimyuxgsgtmu
```

The functions read these secrets: `APP_SIGNING_JWK`, `APP_JWT_SECRET` and
`GOOGLE_VISION_API_KEY`. Set them with `supabase secrets set`. Supabase adds
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` itself.

**Never smoke-test `auth` with a POST.** A new mobile number signs up a blank
EPC. To check that it is up, send an `OPTIONS` request.
