# GrantSearch NZ — Development Standards

## Tech Stack
- Next.js 16 (App Router), React 19, TypeScript
- PostgreSQL (Neon serverless) — raw SQL via @neondatabase/serverless
- NextAuth v5 (JWT strategy)
- Vercel Blob (file storage), Upstash Redis (rate limiting)
- OpenAI, Tavily, Serper (AI/search APIs)

## Security Standards

These apply to ALL code written in this project — features, fixes, and refactors.

### Route Handlers
- Wrap every handler with `authedRoute()` (or `publicRoute()` for the auth endpoints) from `lib/api.ts`.
  The wrapper resolves the session, returns `{ error }` JSON for 401s and thrown `ApiError`s, and logs +
  masks anything unexpected as a generic 500. Do not hand-roll try/catch or return `err.message` to clients.
- Signal expected failures with `throw new ApiError(status, message)`

### Input Validation
- All API route POST/PUT bodies MUST be validated with zod schemas defined in `lib/schemas.ts`
- Use `parseBody(req, schema)` from `lib/api.ts` (it calls `parseOrError()` and throws a 400 on bad JSON or shape)
- Never trust client-provided data — validate types, lengths, and formats server-side
- Query string parameters used in DB queries must be validated before use — `requireIdParam()`, `optionalIdParam()`, `parseIdList()` in `lib/api.ts`
- LLM output is untrusted input: coerce it through a zod schema (see `deepSearchModelOutputSchema`) and clamp scores with `clampScore()` before storing or returning it

### Authentication & Authorization
- All API routes (except public auth endpoints) must use `authedRoute()` from `lib/api.ts`, which calls `getAuthSession()` from `lib/auth-helpers.ts`
- All data queries must include `org_id = $N` to enforce tenant isolation
- Never return data without verifying it belongs to the requesting org
- The `grants` table is shared by all tenants: never write request-supplied values to it. Look the grant up by ID and use the stored name/funder/URL (see `getGrantIdentity()`)

### Rate Limiting
- All public-facing endpoints (auth, signup) must use rate limiters from `lib/rate-limit.ts`
- All expensive operations (search, deep-search, uploads) must be rate-limited by org
- Use `enforceRateLimit(limiter, key)` from `lib/api.ts`; key by `getClientIp()` for anonymous endpoints, `orgId` for authenticated ones

### ID Generation
- Never use `Date.now()` for entity IDs — use `crypto.randomUUID()` or `crypto.randomBytes(16).toString('hex')`
- Generate entity IDs on the server, never in the browser
- Grant IDs use the existing `generateGrantId()` deterministic hash pattern

### Passwords
- Minimum 8 characters enforced server-side (zod schema in `lib/schemas.ts`)
- Always hash with bcrypt, 12 rounds minimum
- Never log or return passwords/hashes in API responses

### API Responses
- Never return more fields than the client needs
- Never return secrets, tokens, or password hashes
- Use generic error messages for auth failures — don't reveal whether an email exists
- Always return consistent error shapes: `{ error: string }`

### Database
- Always use parameterized queries (`$1`, `$2`) — never interpolate values into SQL strings
- JSONB columns should have a corresponding zod schema
- New tables must have appropriate indexes and foreign key constraints
- Multi-statement writes that must succeed or fail together go through `withTransaction()` in `lib/db.ts`

### Outbound Requests
- Any server-side fetch of a URL that came from a user, the database or an LLM must use `safeFetch()` (and `isSafeUrl()`) from `lib/url-safety.ts`
- Never send a secret (e.g. the Blob token) to a URL that has not been checked against the expected host

### Email
- Send through `sendEmail()` in `lib/email.ts`; build content in `lib/email-templates.ts` (escape every interpolated value, always provide a text alternative, no images or tracking)
- Links in emails use `getAppUrl()` from `lib/app-url.ts` — never the request's Host header
- Emailed tokens come from `generateAuthToken()` in `lib/auth-tokens.ts`: store only the hash, make them single use and short lived
- Endpoints that take an email address from a signed-out visitor must respond identically whether or not it is registered; do the lookup and send inside `after()`
- Any password change must set `users.password_changed_at` (signs out older sessions) and call `forgetUser()`
- Never send email without a working rate limit. Endpoints whose only job is to send email use `enforceRateLimit(limiter, key, { failClosed: true })`; endpoints that do other work too take `getRateLimitOutcome()` and only send when `canSendEmail(outcome)` is true
- Holding an invitation link does not prove control of the mailbox (the inviter sees it too) — only a link delivered solely by email may set `users.email_verified`

### File Uploads
- Validate MIME type against allowlist server-side
- Enforce file size limits
- Use `access: 'private'` and `addRandomSuffix: true` for Vercel Blob
- Create the database record in the same request as the upload; never accept or return storage URLs

### Headers & Transport
- Security headers (CSP, X-Frame-Options, etc.) should be configured in `next.config.ts`

## Project Conventions

### File Structure
- API routes: `app/api/<resource>/route.ts`
- Shared utilities: `lib/`
- Zod schemas: `lib/schemas.ts`
- Rate limiters: `lib/rate-limit.ts`
- Auth helpers: `lib/auth-helpers.ts`
- Route wrappers and request helpers: `lib/api.ts`
- Browser data access: `lib/fetcher.ts` (`apiFetch`) and the `lib/*-storage.ts` hooks
- Types: `lib/types.ts`
- DB queries and pool: `lib/db.ts`
- React components: `components/`
- Data pipeline scripts: `scripts/`

### Code Style
- Run `npm run check` (typecheck + lint + tests) before committing
- Client code calls the API through `apiFetch` — never a bare `fetch` whose failure is ignored. Surface errors with `toast.error()` or an `ErrorState`
- Reuse the shared UI in `components/` (`PageShell`, `ConfirmDialog`, `components/grant/*`) and the style constants in `lib/grant-ui.ts` instead of copying markup between pages
- Keep API routes thin — extract shared logic into `lib/` helpers
- Use existing patterns when adding new routes (copy structure from a similar route)
- Don't add unnecessary dependencies — check if existing packages cover the need
