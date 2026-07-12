# Valida (MVP)

Honest, research-backed feedback on a business idea, powered by Claude with web search.

## Stack

- Frontend: Vite + React + TypeScript, plain CSS
- Auth + DB: Supabase (email/password auth, `submissions` table with RLS)
- AI: Anthropic Claude API (web search tool enabled), called from a Supabase Edge Function so the API key never reaches the browser

## Prerequisites

- Node.js 18+ and npm (install from https://nodejs.org if not already installed)
- Supabase CLI (`npm install -g supabase` or see https://supabase.com/docs/guides/cli)
- An Anthropic API key

## 1. Frontend setup

```bash
npm install
npm run dev
```

`.env.local` already contains the Supabase URL and anon key. The dev server runs at http://localhost:5173.

## 2. Deploy the Edge Function

The Claude API call lives in `supabase/functions/analyze` (kept server-side to protect the API key).

```bash
supabase login
supabase link --project-ref mleusalfqvuwwztzoccz
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy analyze
```

Optional: set a different model via `supabase secrets set ANTHROPIC_MODEL_ID=claude-opus-4-8` (defaults to `claude-sonnet-5`).

## 3. Try it out

1. Sign up at `/signup` (Supabase sends a confirmation email by default — check Supabase Auth settings if you want to disable that for local testing).
2. Log in, submit a business idea + niche.
3. The app calls the `analyze` edge function, which inserts a `submissions` row (`status: "processing"`) and returns immediately. The results page polls that row every few seconds until Claude's research finishes and the row flips to `"complete"` (or `"failed"`).
4. Past submissions are listed on the dashboard.

## Deploying to Vercel

The site is gated behind a single shared password until launch (see below). Vercel env vars needed — **only these three, set in the Vercel dashboard, nothing else**:

| Variable | Value | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://mleusalfqvuwwztzoccz.supabase.co` | Public — bundled into the client, this is expected. |
| `VITE_SUPABASE_ANON_KEY` | your Supabase anon key | Public by design — RLS is what actually protects data, not secrecy of this key. |
| `GATE_PASSWORD` | the launch password | **Not** prefixed with `VITE_` — stays server-side, read only by `middleware.ts`, never bundled into client JS. |

The Anthropic API key is **never** a frontend/Vercel variable — it only exists as a Supabase Edge Function secret (`supabase secrets set ANTHROPIC_API_KEY=...`), already configured. Do not add it in Vercel.

Build settings (Vercel auto-detects the Vite framework preset, confirm these on import):
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

### Password gate

`middleware.ts` at the project root blocks every request until the correct password is submitted, then sets an HttpOnly cookie (a hash of the password, not the password itself) valid for 30 days. This only runs on Vercel (or `vercel dev`) — plain `npm run dev` / Vite's dev server does not execute it, so local development is never gated.

## Architecture notes

- **Async scoring.** The Claude call (web search + reasoning) can take well past Supabase Edge Functions' 150s free-tier wall-clock limit, so `analyze` returns fast and does the actual work in the background via `EdgeRuntime.waitUntil(...)`, updating the same row when done. This avoids the synchronous request ever hitting the platform's idle-timeout or per-invocation compute cap. See `supabase/functions/analyze/index.ts`.
  - Known edge case: if the platform kills a background worker mid-run (only possible on a run that itself exceeds the wall-clock cap), the row can stay stuck at `status: "processing"` with no automatic recovery. The results page surfaces a "taking longer than usual" message after 3 minutes as a stopgap; there's no retry/cleanup job yet.
- RLS on `submissions` and `tracked_niches` restricts each user to their own rows (`auth.uid() = user_id`); the edge function calls Supabase using the requesting user's JWT so inserts/updates respect that policy.
- `tracked_niches` is scaffolding for the weekly-monitoring upsell (a user can join a waitlist for a niche from the results page) — no cron job or billing is wired up yet.
- Out of scope for this MVP (per spec): weekly digest/cron, payments, pricing tiers, Reddit integration.
