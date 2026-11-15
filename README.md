# GrantSearch NZ

AI-assisted grant finder for New Zealand non-profits. An organisation describes
itself and what it needs funding for; GrantSearch matches that against a curated
database of NZ funders, scores every relevant grant, and then helps the team
research, shortlist and track applications through to a decision.

## What it does

| Stage | Where | What happens |
| --- | --- | --- |
| **Search** | `/` → `/results` | A four-step form captures the organisation, regions, sectors and funding purpose. Grants are filtered in SQL, then scored in batches by an LLM and streamed to the page as they arrive. |
| **Review** | `/results`, `/saved` | Results are grouped by funder, filterable and sortable, exportable to CSV, and saved automatically so they can be reopened or re-run. |
| **Deep Search** | per grant | Researches one grant in depth (funder site + web search + page extraction) to find deadlines, eligibility criteria, the application form and a checklist, and recalibrates its scores. |
| **Shortlist** | `/shortlisted` | The grants worth pursuing, grouped by the search they came from. |
| **Apply** | `/applications` | Pipeline view with status history, notes, amounts requested/awarded, upcoming deadlines, success rate, and a per-application checklist with attached documents. |
| **Documents** | `/documents` | A reusable library (financials, constitution, …) that can be attached to any checklist item. |
| **Team** | `/settings` | Invite colleagues into the organisation (by email, with a copy-link fallback), manage members, change password. |
| **Account** | `/forgot-password`, `/reset-password/…`, `/verify-email/…` | Emailed password reset and email verification. Unverified accounts see a reminder banner but are not blocked. |

### Scoring

Each grant gets three 0–10 scores, combined in `lib/scoring.ts`:

```
overall = alignment × 0.5 + attainability × 0.3 + ease × 0.2
```

The overall score is always recomputed server-side — model arithmetic is never trusted.

## Tech stack

- **Next.js 16** (App Router), **React 19**, TypeScript, Tailwind CSS v4
- **PostgreSQL** on Neon — raw parameterised SQL via `@neondatabase/serverless`
- **NextAuth v5** — credentials provider, JWT sessions
- **Vercel Blob** (private file storage), **Upstash Redis** (rate limiting)
- **OpenAI** (scoring + analysis), **Serper** (search), **Tavily** (page extraction)

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev
```

Open <http://localhost:3000>.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon PostgreSQL connection string |
| `AUTH_SECRET` | yes | Signs session tokens — `openssl rand -hex 32` |
| `OPENAI_API_KEY` | yes | Grant scoring and deep-search analysis |
| `SERPER_API_KEY`, `TAVILY_API_KEY` | for Deep Search | Web search and page extraction |
| `BLOB_READ_WRITE_TOKEN` | for Documents | Vercel Blob storage |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | in production | Upstash Redis for rate limiting. **Without these, rate limiting is disabled and no email is sent** (password reset and resend-verification return 503). |
| `RESEND_API_KEY` | in production | [Resend](https://resend.com) API key for transactional email (password reset, invitations, email verification) |
| `EMAIL_FROM` | in production | Sender address on a domain verified with Resend, e.g. `GrantSearch NZ <noreply@yourdomain.co.nz>` |
| `APP_URL` | in production | Public base URL used for links in emails, e.g. `https://grants.yourdomain.co.nz`. On Vercel it defaults to the project's production domain. |

Without `RESEND_API_KEY` / `EMAIL_FROM`, emails are written to the server log in
development (the link is in the log, so every flow can be exercised locally)
and sending fails with a clear error in production. Leave open and click
tracking switched off for the sending domain in Resend.

### Database

Schema lives in `migrations/` (run in order). Tenant tables are also created on
demand by `ensureStorageTables()` in `lib/db.ts`. `007_tenant_integrity.sql` is
optional but recommended — it adds foreign keys, check constraints and indexes.
`008_email_flows.sql` is **required**: it adds the password-reset and
email-verification token tables and `users.password_changed_at`, and marks
accounts that already exist as verified. Run it before deploying the code that
depends on it.

The grants database itself is built by the offline pipeline in
`scripts/pipeline/` (see `docs/` for the pipeline guides).

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Node's built-in test runner, no extra dependencies) |
| `npm run check` | Typecheck + lint + tests — run before committing |
| `npm run migrate -- migrations/<file>.sql` | Apply one migration to the database in `.env.local` (rolled back if it fails) |

## Project layout

```
app/
  api/<resource>/route.ts   Thin route handlers (see "API conventions")
  <page>/page.tsx           Client pages
components/
  grant/                    Shared grant UI: scores, deep-search report, deadline badge
  page-shell.tsx            Page chrome: header, empty / loading / error states
  confirm-dialog.tsx        Accessible confirmation modal
  toast.tsx                 Toast notifications (`toast.success(...)`)
lib/
  api.ts                    authedRoute / publicRoute wrappers, parseBody, enforceRateLimit
  auth.ts, auth-helpers.ts  NextAuth config, session revalidation, getAuthSession()
  email.ts                  sendEmail() — Resend over REST; logs instead in development
  email-templates.ts        Plain HTML + text content for each email (pure, tested)
  account-emails.ts         Reset / verification / invitation emails: token + send
  auth-tokens.ts            Hashed single-use tokens, session-staleness check
  app-url.ts                Trusted base URL for links in emails
  schemas.ts                Every zod schema (request bodies, JSONB shapes, model output)
  db.ts                     Pool, withTransaction, grant queries, table bootstrap
  url-safety.ts             SSRF protection: isSafeUrl, safeFetch
  fetcher.ts                Browser-side apiFetch (throws on non-2xx)
  *-storage.ts              SWR hooks + mutations per resource
  grant-ui.ts               Grant type / application status styling, shared class strings
  scoring.ts                The scoring formula
  pipeline/                 Shared code for the offline data pipeline
migrations/                 SQL migrations
scripts/pipeline/           Offline funder/grant data pipeline
tests/                      Unit tests
proxy.ts                    Auth gate, CSRF origin check, per-request CSP nonce
```

## API conventions

Every route handler is wrapped, so authentication, validation and error handling
are uniform:

```ts
export const POST = authedRoute(async (req, { orgId, userId }) => {
  await enforceRateLimit(someLimiter, orgId);          // 429 + Retry-After
  const body = await parseBody(req, someSchema);       // 400 on bad JSON / shape
  const { rows } = await getPool().query(
    'SELECT … FROM things WHERE org_id = $1 AND id = $2', [orgId, body.id],
  );
  if (rows.length === 0) throw new ApiError(404, 'Thing not found');
  return NextResponse.json(rows[0]);
});
```

- Errors are always `{ "error": string }`. Expected failures throw `ApiError`;
  anything else is logged and returned as a generic 500 (no internals leak).
- Every query on a tenant table filters by `org_id` from the session — never
  from the request.
- IDs, timestamps and status history are generated server-side.
- On the client, use `apiFetch` from `lib/fetcher.ts`; it throws on failure so
  the UI can show a toast or an error state instead of an empty page.

## Security model

- **Tenancy** — data is scoped to an organisation; `org_id` comes from the
  session. Sessions are re-checked against the database every few minutes, so a
  removed member loses access without waiting for their token to expire.
- **Shared grants table** — Deep Search writes what it learns back to the grants
  table that all tenants read. The grant's identity and URL therefore come from
  the database, not the request, and only validated values fill empty columns.
- **Model output is untrusted input** — it is coerced through zod
  (`deepSearchModelOutputSchema`), scores are clamped, and only `http(s)` links
  are stored or rendered.
- **SSRF** — any server-side fetch of an external URL goes through `safeFetch`
  (https only, public addresses only, redirects re-validated, size and time caps).
- **Files** — MIME allowlist + magic-byte check + 10 MB cap; stored privately
  under an org prefix. The storage URL never leaves the server, and downloads
  are streamed through an authenticated route as attachments.
- **Auth** — bcrypt (12 rounds), constant-time login for unknown emails,
  rate-limited login/sign-up/invite, hashed single-use invitation tokens.
- **Email flows** — reset and verification tokens are random, stored only as
  SHA-256 hashes, single use and short lived (1 hour / 24 hours). "Forgot
  password" answers identically for any address and does its work after the
  response is sent; it is rate limited per IP and per address. Links are built
  from `APP_URL`, never from the request's Host header. Changing or resetting a
  password stamps `users.password_changed_at`, and sessions that signed in
  before it are rejected at their next revalidation (within a few minutes).
- **Browser** — per-request CSP nonce, origin check on state-changing requests,
  `X-Frame-Options: DENY`, HSTS, `nosniff`.

Coding standards for contributors (human or AI) are in [CLAUDE.md](CLAUDE.md).

## Known gaps

- No role-based access control — every member of an organisation can manage it
  (deliberately deferred).
- Email verification only nudges: an unverified account can use everything.
  Accounts created before `008_email_flows.sql` count as verified. Accounts
  created from an invitation start unverified and are sent a verification
  email, because the invitation link is also shown to the inviter.
- Email is only sent while rate limiting is working. In production without
  Redis (or while Redis is failing), "forgot password" and "resend
  verification" return 503, and sign-up and invitations still work but send no
  email (the inviter copies the link instead).
- Other devices are signed out a few minutes after a password change, not
  instantly (sessions are JWTs re-checked every 5 minutes).
- No "your password was changed" notification email, and users cannot change
  their email address.
- Email delivery has not been tested against a live Resend account, and there
  is no bounce/complaint handling.
