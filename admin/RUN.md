# Capital Craft — frontend (app.capitalcraft.in)

Next.js 14 App Router + TypeScript + Tailwind. Talks to the Supabase backend
already in `D:\capital craft\capital craft backend\supabase\`.

## 1. Install once

```powershell
cd "D:\capital craft\capital craft frontend"
npm install
```

(If you don't have Node yet: install Node 20 LTS from nodejs.org.)

## 2. Set env vars

```powershell
Copy-Item .env.local.example .env.local
```

Open `.env.local` and paste the anon key from `capitalcraft-build/keys.txt`
into `NEXT_PUBLIC_SUPABASE_ANON_KEY=`. The Supabase URL and functions URL are
already filled in.

> **You also need to have deployed the backend** (see backend `DEPLOY.md` steps
> 1-4). Without the live `auth` Edge Function, login won't work.

## 3. Run the dev server

```powershell
npm run dev
```

Open http://localhost:3000 — you should see the login page styled exactly like
www.capitalcraft.in (Inter + Space Grotesk, the same blues and greens).

## 4. Smoke test the flow

1. Log in with mobile `9999900001` and OTP `1234`. That's the seeded admin
   account — you land on `/admin`. Use it to look around.
2. Open a new incognito window. Log in with any new 10-digit mobile (any number
   starting 6-9) and OTP `1234`. You land on Step 1 of onboarding.
3. Walk through Steps 1-3 (required), skip 4-6, hit Submit on the review page
   → you land on `/status` ("Under review").
4. Switch back to the admin window, refresh `/admin`, open the new EPC,
   approve them.
5. Refresh the EPC window — it routes you to `/dashboard`. Create a loan
   application, save as draft, then submit.
6. Back to admin: open the application, change status through
   `under_review` → `approved` → `sent_to_nbfc` → `disbursed`.

## 5. Production build (later, when ready to deploy)

```powershell
npm run build
npm start
```

Deploy to a new Netlify site (separate from www.capitalcraft.in). Subdomain
`app.capitalcraft.in` → CNAME to the Netlify site URL. Set the three env vars
in the Netlify dashboard.

When deploying to prod, remember to swap the Edge Function CORS from `*` to
`https://app.capitalcraft.in` (backend `DEPLOY.md` step 7).
