# GrantSearch NZ — Development Standards

## Tech Stack
- Next.js 16 (App Router), React 19, TypeScript
- PostgreSQL (Neon serverless) — raw SQL via @neondatabase/serverless
- NextAuth v5 (JWT strategy)
- Vercel Blob (file storage), Upstash Redis (rate limiting)
- OpenAI, Tavily, Serper (AI/search APIs)

## Security Standards

These apply to ALL code written in this project — features, fixes, and refactors.

### Input Validation
- All API route POST/PUT bodies MUST be validated with zod schemas defined in `lib/schemas.ts`
- Use `parseOrError()` from `lib/schemas.ts` — return 400 on failure
- Never trust client-provided data — validate types, lengths, and formats server-side
- Query string parameters used in DB queries must be validated before use

### Authentication & Authorization
- All API routes (except public auth endpoints) must call `getOrgId()` or `getAuthSession()` from `lib/auth-helpers.ts`
- All data queries must include `org_id = $N` to enforce tenant isolation
- Never return data without verifying it belongs to the requesting org

### Rate Limiting
- All public-facing endpoints (auth, signup) must use rate limiters from `lib/rate-limit.ts`
- All expensive operations (search, deep-search, uploads) must be rate-limited by org
- Use `getClientIp()` for anonymous endpoints, `orgId` for authenticated ones

### ID Generation
- Never use `Date.now()` for entity IDs — use `crypto.randomUUID()` or `crypto.randomBytes(16).toString('hex')`
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

### File Uploads
- Validate MIME type against allowlist server-side
- Enforce file size limits
- Use `access: 'private'` and `addRandomSuffix: true` for Vercel Blob

### Headers & Transport
- Security headers (CSP, X-Frame-Options, etc.) should be configured in `next.config.ts`

## Project Conventions

### File Structure
- API routes: `app/api/<resource>/route.ts`
- Shared utilities: `lib/`
- Zod schemas: `lib/schemas.ts`
- Rate limiters: `lib/rate-limit.ts`
- Auth helpers: `lib/auth-helpers.ts`
- Types: `lib/types.ts`
- DB queries and pool: `lib/db.ts`
- React components: `components/`
- Data pipeline scripts: `scripts/`

### Code Style
- Keep API routes thin — extract shared logic into `lib/` helpers
- Use existing patterns when adding new routes (copy structure from a similar route)
- Don't add unnecessary dependencies — check if existing packages cover the need
