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
| **Team** | `/settings` | Invite colleagues into the organisation, manage members, change password. |

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
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | recommended | Upstash Redis for rate limiting. **Without these, rate limiting is disabled.** |

### Database

Schema lives in `migrations/` (run in order). Tenant tables are also created on
demand by `ensureStorageTables()` in `lib/db.ts`. `007_tenant_integrity.sql` is
optional but recommended — it adds foreign keys, check constraints and indexes.

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
- **Browser** — per-request CSP nonce, origin check on state-changing requests,
  `X-Frame-Options: DENY`, HSTS, `nosniff`.

Coding standards for contributors (human or AI) are in [CLAUDE.md](CLAUDE.md).

## Known gaps

- No email delivery yet: invitation links are copied manually, and there is no
  email verification or "forgot password" flow.
- No role-based access control — every member of an organisation can manage it
  (deliberately deferred).
- Changing a password does not sign out other devices.
