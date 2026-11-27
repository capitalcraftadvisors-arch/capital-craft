# How the app is built

Next.js 14 (App Router) with React 18, TypeScript (strict) and Tailwind 3. It is
built as a standalone server and runs on Cloud Run (`capitalcraft-app`,
asia-southeast1).

## The moving parts

```
Browser ──► Next.js pages (client components)
   │            │
   │            ├──► Supabase Postgres directly, with the user's own token (RLS decides)
   │            └──► /api/* routes on the same server
   │                     ├──► Supabase, still as the user (dbAs(token))
   │                     ├──► Google Cloud Storage (bucket capitalcraft-docs)
   │                     ├──► Google Vision / Gemini (reading documents)
   │                     └──► Gmail SMTP, AiSensy WhatsApp
   └──► Supabase Edge Functions: auth (login), extract-* (OCR)
```

**Login.**
1. `LoginForm` calls the `auth` Edge Function, which returns a signed ES256 token.
2. The token is stored in `localStorage` (`cc_token`).
3. `lib/supabase.ts` attaches it to every database call, and `lib/auth.ts`
   `authHeaders()` attaches it to every `/api` call.
4. The token's claims carry `role`, `business_id`, `business_type` (`admin` = the
   Capital Craft team) and, for the team, `hierarchy_role` plus the allowed modules.
5. Row-level security in Postgres reads those claims.

**Who may open what.**
- Pages: wrap them in `<AuthGuard allow={[…]}>`.
- `/api` routes: start with `requireLogin(req, { role })` from `lib/api.ts`.
- Team modules: `lib/hierarchy.ts` and `lib/auth.ts` (`canAccessModule`).
- EPC staff roles: `lib/epc-roles.ts`.

## Folder map — `src/`

```
app/
  admin/              Capital Craft portal
    page.tsx + _console/   the console tabs (loans, EPCs, insurance, leads …)
    app/[id]/              one loan: view, step-1…6, approval, disbursement, messages
    app/intake/            the loan intake chat
    board/                 Task Manager + My Day
    epc/, insurance/, other-insurance/, lead/, stakeholders/, pendings/
    analytics/, team-analytics/, gozerobils/, pri/ (owner), tools/
  dashboard/          Partner Portal (EPCs): loans, apply/chat, insurance, quotes,
                      quotation, projects, invoices, leads, settings
  onboarding/         EPC sign-up steps
  login/, status/, apply/ (public customer form), p/[token] (quotation link)
  api/
    admin/…           team-only routes        epc/…    Partner Portal routes
    upload, document/[id]   store and open files in GCS
    f/[token]         90-day file links in lender emails
    cron/followups    daily reminders (Cloud Scheduler, x-cron-key)
    gozerobils/leads  leads from gozerobils (x-api-key)
    mcp/[key]         read-only Claude connector: portal data (lib/mcp-tools) + the live code from GitHub (lib/mcp-code)
    leads             public customer form
components/
  ui/          Button, Card, Input, Select, DateField, Modal, ConfirmHost
  chat/        the chat kit used by every chat screen
  loan-form/   the loan wizard kit (step header, fields, choices, docs, requests)
  view/        ViewKit: profile pages (sections, KPI tiles, doc grid, viewer)
  partner/     Partner Portal pieces    quotation/   quotation form kit
  analytics/   charts (recharts)
lib/           shared logic (below); unit tests in lib/__tests__
```

Big pages keep their pieces in a `_parts/` folder next to `page.tsx`.

## Use these, don't rewrite them

| Need | Use |
|---|---|
| An `/api` route: login check, error reply, DB client | `lib/api`: `requireLogin`, `err`, `dbAs`, `publicDb`, `strOrNull`, `numOrNull`, `loadLoanRow` |
| Calling `/api` from a page | `authHeaders()` from `lib/auth` |
| Error text from a caught value | `errText(e)` from `lib/errors` |
| A message to the user | `notify.error / success / info` from `lib/notify` (never `alert`) |
| A yes/no question | `await askConfirm(msg, { danger })` from `lib/confirm` (never `confirm`) |
| A pop-up | `components/ui/Modal` (focus, Escape and backdrop rules are built in); deletes use `ConfirmDeleteModal` |
| Closing a menu on an outside click | `lib/use-close-on-outside-click` |
| Dates | `lib/dates`: `fmtDate` (DD/MM/YYYY), `fmtDateIST` / `todayIST` on the server, `fmtDob` for OCR'd birth dates |
| Money | `lib/money`: `fmtRupees`, `fmtRupeesExact`, `amountInput` |
| Checking PAN, mobile, IFSC, GSTIN … | `lib/validators` |
| Uploading or opening a file | `lib/storage`: `uploadDocument`, `openDocument`, `openLoanDoc`, `saveDownload` |
| Server-side file and OCR steps | `lib/extract-server`, `lib/vision-server`, `lib/gemini-extract` |
| Which loan documents are required | `lib/loan-doc-checklist` (the only rule) |
| The 2nd-tranche documents, their names and the EPC's lock | `lib/disbursement`: `COMPLETION_DOCS`, `COMPLETION_OTHER`, `TRANCHE2_KEYS`, `completionLabel`, `tranche2Lock` |
| A profile's Back to the list that opened it (+ the row blink) | `components/view/hooks`: `rememberReturn` / `takeReturn` / `backLabel`; `useReturnHighlight` in `app/admin/_console/kit` |
| Loan labels and display IDs | `lib/loan-labels` |
| The lender list | `useLenders` / `addLender` (`lib/lenders`); per-loan lender rows in `lib/loan-lenders` |
| Sending a lender pack | `lib/lender-pack` |
| A ZIP download | `lib/zip-response` |
| A column whose migration may not be live yet | `lib/optional-column` |
| Caching a big list in the tab | `lib/list-cache` |
| Colours | the tokens in `tailwind.config.ts` (`cc-*`, `navy-*`, `warn-*` …), not new hex codes |

## Data rules worth knowing

- **Loan documents live in two places.** There are `user_application_docs`
  rows, and there are `*_path` columns on `epc_applications`. Code that reads
  documents must handle both. `lib/loan-doc-checklist` already does.
- **One lender list.** The `lenders` table is the only source, and database
  triggers keep the other tables in line with it.
- **Each lender's decision** is a row in `loan_application_lenders`. The loan
  row also carries the headline status (`approved_lender`, `rejected_lender` …).
  Change both together.
- **No extra traffic.** After a change, patch the row in memory. Don't reload
  the whole list. No polling, no refetch on focus.

## Tests and checks

- `npm test` runs vitest over `src/lib/__tests__`: plain functions only, no
  network and no database.
- `npm run lint` runs ESLint (`next/core-web-vitals`). The few
  `eslint-disable react-hooks/exhaustive-deps` lines are deliberate: adding
  those dependencies would make the effect read from the database again.
- `npm run typecheck` and `npm run build` must pass before any deploy.

## Security headers

`next.config.js` sends these on every response:
- `nosniff`;
- a strict Referrer-Policy;
- same-origin framing only (`X-Frame-Options` and `frame-ancestors`);
- HSTS;
- a Permissions-Policy that allows the camera and location only for the app itself.

The old Partner Portal loan-form URLs redirect to `/dashboard/apply/chat`.
