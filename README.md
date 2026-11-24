# Capital Craft

The web app behind **app.capitalcraft.in**. One Next.js app serves two portals:

| Portal | Who uses it | Lives under |
|---|---|---|
| **Capital Craft portal** | the Capital Craft team | `/admin/*` |
| **Partner Portal** | EPCs (our customers) and their staff | `/dashboard/*`, `/onboarding/*` |

Shared public pages: `/login`, `/apply` (the customer form linked from the
marketing site), `/p/<token>` (a quotation link an EPC sends), `/status`.

## Repository layout

```
admin/      the Next.js app (both portals + every /api route)  → see admin/ARCHITECTURE.md
backend/    Supabase: SQL migrations + Edge Functions          → see backend/DEPLOY.md
website/    a copy of the marketing site (capitalcraft.in); published by hand on Netlify
```

## Run it locally

Needs Node 20.

```powershell
cd admin
npm ci
npm run dev        # http://localhost:3000
```

Local runs use the **TEST** Supabase project, set in `admin/.env.local` (never
committed). The variables the app reads:

| Variable | Used for | Where it is set in production |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` | the Supabase project (public values) | `admin/.env.production` (not committed) |
| `APP_JWT_SECRET` | old login tokens (HS256 bridge in `lib/jwt.ts`) | Secret Manager |
| `GMAIL_SENDER`, `GMAIL_APP_PASSWORD` | lender and reminder emails (`lib/mailer.ts`) | Secret Manager |
| `SUSTERA_GMAIL_APP_PASSWORD` | Sustera customer-application emails | Cloud Run |
| `GOOGLE_VISION_API_KEY`, `GEMINI_MODEL` | document reading (Vision + Gemini) | Cloud Run |
| `GCS_BUCKET` | document storage (default `capitalcraft-docs`) | Cloud Run |
| `AISENSY_API_KEY` | WhatsApp messages | Cloud Run |

## Checks

Run these from `admin/` before every commit:

```powershell
npm run typecheck   # tsc --noEmit
npm run lint        # next lint (ESLint, next/core-web-vitals)
npm test            # vitest: unit tests in src/lib/__tests__
npm run build       # the production build
```

## Deploy

A deploy has two steps, always in this order:

1. **Database first.** Apply any new migration in `backend/supabase/migrations`
   to the live project, one file at a time. Never use `supabase db push` (see
   `backend/DEPLOY.md`).
2. **App.** Run `gcloud run deploy capitalcraft-app --source=. --memory=2Gi …`
   from `admin/` (the full command is at the top of `admin/cloudbuild.yaml`).
   Then push the branch to `main`. The push also redeploys through Cloud Build,
   so everything the app needs at runtime must be committed.

Never ship code that reads a new column before its migration is live. Use
`lib/optional-column.ts` when an old and a new schema have to work side by side.

## House rules

- **No extra database traffic.** The project is on Supabase's Free plan. No
  polling, no refetch on window focus, no reloading a whole list after a
  one-row change, no short cache lifetimes. Patch the row you changed.
- **This repository is public.** No customer data, keys, passwords or real
  documents. EPC quotation templates live only in the GCS bucket.
- **Use the shared helpers** listed in `admin/ARCHITECTURE.md`. Don't write a
  second copy of something that already exists.
- **Dates** are shown as DD/MM/YYYY (`lib/dates`). **Money** goes through `lib/money`.
