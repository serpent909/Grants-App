# GrantSearch NZ — How It Works

A complete technical reference covering the end-to-end search pipeline, every API call, data transformations, assumptions, and constraints.

---

## Table of Contents

1. [High-Level Overview](#1-high-level-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Tech Stack](#3-tech-stack)
4. [User Input (Search Form)](#4-user-input-search-form)
5. [The Search Pipeline — Step by Step](#5-the-search-pipeline--step-by-step)
   - [Step 0: Funder Discovery (Directory Mining)](#step-0-funder-discovery-directory-mining)
   - [Step 1: Organisation Analysis & Funder Enumeration](#step-1-organisation-analysis--funder-enumeration)
   - [Step 2: Massive Parallel Search](#step-2-massive-parallel-search)
   - [Step 3: Page Extraction & Filtering](#step-3-page-extraction--filtering)
   - [Step 4: GPT Grant Extraction](#step-4-gpt-grant-extraction)
   - [Step 5: Intelligent Scoring](#step-5-intelligent-scoring)
6. [Results Display](#6-results-display)
7. [All External API Calls](#7-all-external-api-calls)
8. [Database Layer](#8-database-layer)
9. [Filtering & Deduplication Logic](#9-filtering--deduplication-logic)
10. [Scoring Algorithm](#10-scoring-algorithm)
11. [Cost Tracking](#11-cost-tracking)
12. [Rate Limiting & Retry Logic](#12-rate-limiting--retry-logic)
13. [Assumptions](#13-assumptions)
14. [Constraints & Limitations](#14-constraints--limitations)
15. [Environment Variables](#15-environment-variables)
16. [Process Flow Diagram (Detailed)](#16-process-flow-diagram-detailed)

---

## 1. High-Level Overview

GrantSearch NZ is an AI-powered grant discovery tool for New Zealand nonprofits. When a user submits a search, the app executes a multi-stage pipeline that:

1. **Discovers** grant-giving organisations from directories, a curated database, and GPT's knowledge
2. **Searches** the web for each funder's grant application pages using 300–400+ Google Search queries
3. **Extracts** page content from 150–200+ URLs via web scraping
4. **Parses** the extracted content with GPT to identify individual grant programs
5. **Scores** each grant for alignment, ease-of-application, and attainability
6. **Returns** a ranked list of matching grants to the user

The entire process takes approximately 2–3 minutes and costs ~$3–4 per search in API fees.

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              USER'S BROWSER                                      │
│                                                                                  │
│  ┌─────────────────────┐                    ┌──────────────────────────────────┐  │
│  │   Search Form        │  ──── POST ─────▶ │   Results Page                   │  │
│  │   (app/page.tsx)     │  /api/search       │   (app/results/page.tsx)         │  │
│  │                      │                    │                                  │  │
│  │  • Website URL       │                    │  • Grants sorted by score        │  │
│  │  • LinkedIn (opt)    │                    │  • Grouped by funder             │  │
│  │  • Market (NZ/AU)    │                    │  • Filter / sort / bookmark      │  │
│  │  • Regions           │   sessionStorage   │  • Score rings (alignment,       │  │
│  │  • Sectors           │  ◀────────────────▶│    ease, attainability)          │ │
│  │  • Org type          │                    │  • Save search (localStorage)    │  │
│  │  • Funding purpose   │                    │                                  │  │
│  │  • Amount sought     │                    └──────────────────────────────────┘  │
│  │  • Previous funders  │                                                         │
│  └─────────────────────┘                                                         │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ POST /api/search
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        NEXT.JS API ROUTE (Server-Side)                           │
│                        app/api/search/route.ts (1636 lines)                      │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │                     PARALLEL INITIALIZATION                                 │  │
│  │                                                                             │  │
│  │  Step 0: Directory Mining          Step 1: Funder Enumeration               │  │
│  │  ┌──────────────────────┐          ┌──────────────────────────┐             │  │
│  │  │ Extract 12 grant     │          │ Extract org website      │             │  │
│  │  │ directory pages      │──Tavily  │ content                  │──Tavily     │  │
│  │  │                      │          │                          │             │  │
│  │  │ Harvest funder links │          │ 7 parallel GPT-4o calls  │             │  │
│  │  │ from content         │          │ to enumerate funders by  │──OpenAI     │  │
│  │  │                      │          │ category (80-150 total)  │             │  │
│  │  │ Site: searches in    │          │                          │             │  │
│  │  │ each directory       │──Serper  │ 1 GPT-4o call to         │             │  │
│  │  │ domain               │          │ enumerate programs       │──OpenAI     │  │
│  │  │                      │          │ (40-50 specific programs)│             │  │
│  │  │ Discover additional  │          └──────────────────────────┘             │  │
│  │  │ directories via GPT  │──OpenAI                                           │  │
│  │  └──────────────────────┘    Regional Queries  │  DB Lookup                 │  │
│  │                              ┌──────────────┐  │  ┌──────────────────┐      │  │
│  │                              │ GPT generates │  │  │ Neon Postgres    │      │  │
│  │                              │ 20-30 local   │  │  │ Full-text search │      │  │
│  │                              │ funder queries│  │  │ up to 200        │      │  │
│  │                              └──────────────┘  │  │ charities        │      │  │
│  │                                                │  └──────────────────┘      │  │
│  └────────────────────────────────────────────────┼────────────────────────────┘  │
│                                                   │                              │
│  ┌────────────────────────────────────────────────┼────────────────────────────┐  │
│  │                  Step 2: MASSIVE PARALLEL SEARCH                            │  │
│  │                                                                             │  │
│  │  300-400+ Serper (Google Search) queries executed concurrently (20 at a    │  │
│  │  time) across these categories:                                             │  │
│  │                                                                             │  │
│  │  • 80-150 enumerated funder searches (from Step 1)                         │  │
│  │  • 40-50 enumerated program searches (from Step 1)                         │  │
│  │  • 8 static seed queries (from market config)                              │  │
│  │  • 10 purpose-driven seed queries (GPT-4o-mini generated)                  │  │
│  │  • 20-30 regional/local funder queries (GPT-4o-mini generated)             │  │
│  │  • 10-15 associative gap-fill queries (GPT-4o-mini generated)              │  │
│  │  • 50+ broad category queries (sector × region × grant terms)              │  │
│  │  • 12 directory deep-dive queries (site: searches)                         │  │
│  │  • 20-25 second-pass gap-fill queries (GPT-4o-mini generated)              │  │
│  │  • 40-100+ per-funder site crawl queries                                   │  │
│  │                                                                             │  │
│  │  Result: ~2000+ raw search hits → deduplicated to ~200+ unique URLs        │  │
│  └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                   │                              │
│  ┌────────────────────────────────────────────────┼────────────────────────────┐  │
│  │                  Step 3: PAGE EXTRACTION                                    │  │
│  │                                                                             │  │
│  │  1. Filter URLs through grant-page classifier (remove careers, login, etc) │  │
│  │  2. Region-filter curated URLs (only include relevant regions)             │  │
│  │  3. Per-domain cap: max 3 URLs per domain                                  │  │
│  │  4. Extract content via Tavily API (batches of 20, 8 concurrent)           │  │
│  │  5. Fallback: site:domain search for failed extractions                    │  │
│  │  6. Fallback: use original Serper snippet if >200 chars                    │  │
│  │  7. Inject enriched DB funders as synthetic pages (no Tavily cost)         │  │
│  │                                                                             │  │
│  │  Result: 150-200+ pages with content (max 8000 chars each)                 │  │
│  └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                   │                              │
│  ┌────────────────────────────────────────────────┼────────────────────────────┐  │
│  │                  Step 4: GRANT EXTRACTION                                   │  │
│  │                                                                             │  │
│  │  Pages batched in groups of 4 → GPT-4o-mini parses each batch              │  │
│  │  Extracts: name, funder, type, description, amounts, URL, pageContent      │  │
│  │  Filters: error pages, news articles, past-recipient lists                 │  │
│  │  Deduplicates by funder + grant name                                        │  │
│  │                                                                             │  │
│  │  Result: 50-200 unique discovered grants                                    │  │
│  └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                   │                              │
│  ┌────────────────────────────────────────────────┼────────────────────────────┐  │
│  │                  Step 5: SCORING                                            │  │
│  │                                                                             │  │
│  │  Grants batched in groups of 25 → GPT-4o scores each batch                 │  │
│  │                                                                             │  │
│  │  Per grant:                                                                 │  │
│  │    alignment (0-10)   × 0.5  →  mission + request fit                      │  │
│  │    attainability (0-10) × 0.3  →  competition + eligibility                │  │
│  │    ease (0-10)        × 0.2  →  application complexity                     │  │
│  │    ─────────────────────────                                                │  │
│  │    overall (0-10)     = weighted sum                                         │  │
│  │                                                                             │  │
│  │  Pre-scoring checks:                                                        │  │
│  │    • URL quality check (news article → zero out)                            │  │
│  │    • Geographic eligibility check (wrong country → zero out)                │  │
│  │    • Regional relevance adjustment (wrong region → -3 to -4 attainability) │  │
│  │                                                                             │  │
│  │  Post-scoring filter: only grants with alignment ≥ 5 returned              │  │
│  │  First batch also generates orgSummary (2-3 sentence org description)       │  │
│  │                                                                             │  │
│  │  Result: Final ranked list of grants with scores + reasoning               │  │
│  └─────────────────────────────────────────────────────────────────────────────┘  │
│                                                   │                              │
│                                            JSON Response                         │
│                                  { grants, orgSummary, searchedAt, market }      │
└──────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
                               ┌───────────────┐
                               │ sessionStorage │ → Results page reads & displays
                               └───────────────┘
```

---

## 3. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 14 (App Router), React 19, TypeScript | UI & routing |
| Styling | Tailwind CSS 4, shadcn/ui | Design system |
| Backend | Next.js API Routes (Node.js) | Server-side pipeline |
| AI Models | OpenAI GPT-4o, GPT-4o-mini | Enumeration, extraction, scoring |
| Web Search | Serper API (Google Search wrapper) | Funder discovery |
| Web Scraping | Tavily API | Page content extraction |
| Database | Neon Postgres (serverless) | NZ Charities Register data |
| Hosting | Vercel | Deployment |
| State | sessionStorage, localStorage | Client-side result & saved search storage |

---

## 4. User Input (Search Form)

The search form (`app/page.tsx`) collects the following `OrgInfo` object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `website` | string | Yes | Organisation's website URL |
| `linkedin` | string | No | LinkedIn profile URL |
| `market` | string | Yes | Market ID: `'nz'` or `'au'` |
| `regions` | string[] | Yes | Region IDs the org operates in (e.g. `['auckland', 'waikato']`) |
| `sectors` | string[] | Yes | Sector IDs (e.g. `['health', 'youth']`) |
| `orgType` | string | Yes | One of: `registered-charity`, `charitable-trust`, `incorporated-society`, `social-enterprise`, `community-group`, `other` |
| `fundingPurpose` | string | Yes | Free-text description of what funding is needed for |
| `fundingAmount` | number | Yes | Dollar amount sought (NZD or AUD) |
| `previousFunders` | string | No | Free-text list of current/previous funders |

**Validation:** URL format validation on website field. All required fields must be filled before submission.

**On submit:** The form POSTs to `/api/search`, displays a 9-stage loading overlay with progress messages, then navigates to `/results` where the response is read from `sessionStorage`.

---

## 5. The Search Pipeline — Step by Step

### Step 0: Funder Discovery (Directory Mining)
**Runs in parallel with Step 1**

**Purpose:** Mine known grant directory websites (like fundinginformation.org.nz) to discover funder URLs that aren't in the curated list.

**Sub-steps:**

**0a — Directory Page Extraction:**
- Extracts content from all grant directory URLs in the market config (12 for NZ) via Tavily API
- Parses the extracted HTML/text for embedded URLs using regex: `https?:\/\/[^\s"')>\]]+`
- Filters out links pointing back to the directory's own domain and excluded domains (news sites, social media)
- Captures external links as potential funder URLs

**0b — Site-Search Mining:**
For each of the 12 NZ grant directories, generates and executes a large batch of `site:domain` search queries via Serper:
- Base queries: `site:{domain} grants apply`, `site:{domain} grants {year}`, etc. (6 per directory)
- Per-sector queries: `site:{domain} {sector} grants` (2 per sector per directory)
- Per-region queries: `site:{domain} {region} grants` (2 per region per directory)
- Sector × region combos: `site:{domain} {region} {sector} grants` (up to 24 per directory)
- All queries deduplicated before execution
- Executed with concurrency limit of 20

**0c — Additional Directory Discovery:**
- GPT-4o-mini generates 5–8 additional grant directory/aggregator websites not in the curated list
- Each suggested directory is validated via a Serper search — hallucinated domains return zero results (self-correcting)
- Any valid results are added to the URL pool

**API calls in Step 0:**
- Tavily extract: 12 directory URLs
- Serper searches: ~100–200 site: queries + 5–8 validation queries
- OpenAI (GPT-4o-mini): 1 call for directory discovery

---

### Step 1: Organisation Analysis & Funder Enumeration
**Runs in parallel with Step 0**

**Purpose:** Understand the organisation and generate an exhaustive list of potential funders and programs.

**Sub-steps (all run in parallel via `Promise.allSettled`):**

**1a — Organisation Website Extraction:**
- Tavily extracts the org's website content
- Truncated to 3000 characters
- Used later for purpose-driven seed queries and scoring context

**1b — Funder Enumeration (7 parallel GPT-4o calls):**
Each call handles a subset of funder categories to maximise coverage within token limits:

| Call | Categories | Token Budget |
|------|-----------|--------------|
| 1 | Local councils / territorial authorities (NZ has 78) | 14,000 |
| 2 | Government, Crown entities, Lottery distributors | 14,000 |
| 3 | Community foundations, private foundations, corporate foundations, charitable trusts | 14,000 |
| 4 | Corporate CSR, industry associations, faith-based trusts | 14,000 |
| 5 | Federated giving, ethnic/cultural associations, neighbourhood grants | 14,000 |
| 6 | International bodies, NGOs, global thematic funds | 14,000 |
| 7 | University partnership grants, social enterprise programmes | 14,000 |

Each call returns a JSON array of funders with: `name`, `category`, `region`, `searchQuery`

Example output:
```json
{ "name": "Pub Charity", "category": "Gaming Trust", "region": "national", "searchQuery": "Pub Charity grants apply New Zealand 2026" }
```

Results are merged and deduplicated by lowercased name. If JSON is truncated (exceeds token limit), a regex recovery mechanism extracts all complete funder objects from the partial output.

**1c — Database Lookup:**
- Queries Neon Postgres for grant-giving charities matching the user's sectors and funding purpose
- Maps user sector IDs → NZ Charities Register sector IDs via `REGISTER_SECTOR_MAP`
- Builds PostgreSQL full-text search query from purpose keywords + region names
- Returns up to 200 charities ranked by `ts_rank` relevance
- Results split into:
  - **Enriched** (have `grant_summary`): Injected directly at Step 3 — no Tavily cost
  - **Unenriched** (no summary): Their `grant_url` or `website_url` added to extraction queue

**1d — Program Enumeration:**
- Single GPT-4o call identifies 40–50 specific named grant *programs* (not just funders)
- Focuses on sub-programs, sector-specific fund windows, thematic cross-sector programs
- Returns: `name`, `funder`, `sector`, `searchQuery`

**Also started in parallel:**
- **Regional Search Generation** (GPT-4o-mini): Generates 20–30 targeted local/regional funder queries
- **DB Funder Lookup**: Queries Postgres for charities matching user's sectors/purpose

**API calls in Step 1:**
- Tavily extract: 1 URL (org website)
- OpenAI GPT-4o: 7 enumeration calls + 1 program call = 8 calls
- OpenAI GPT-4o-mini: 1 call (regional searches)
- Neon Postgres: 1 query

---

### Step 2: Massive Parallel Search
**Depends on Step 0 + Step 1 results**

**Purpose:** Execute hundreds of web searches to find actual grant application pages for every discovered funder and program.

**Search sources (all run concurrently with 20-concurrent limit):**

| Source | Queries | Description |
|--------|---------|-------------|
| Enumerated funder searches | 80–150 | One Serper query per funder from Step 1b |
| Enumerated program searches | 40–50 | One Serper query per program from Step 1d |
| Static seed queries | 8 | Template queries from market config, interpolated with purpose/year |
| Purpose-driven seeds | 10 | GPT-4o-mini generates queries from org website content |
| Regional queries | 20–30 | GPT-4o-mini generates local funder queries |
| Associative gap-fill | 10–15 | GPT-4o-mini identifies missing funders from Step 1 results |
| Broad category searches | 50+ | Sector × region × grant term combinations (generated programmatically) |
| Directory deep-dives | 12 | `site:` searches within each known directory domain |
| Second-pass gap-fill | 20–25 | GPT-4o-mini analyses found domains, generates queries for gaps |
| Per-funder site crawl | 40–100+ | For each unique funder domain found, searches *within* that domain for grants/apply pages |

**Search execution:**
- All queries sent to Serper API (Google Search wrapper)
- Concurrency limit: 20 simultaneous queries
- Each query returns up to 10 results
- Results: URL + search snippet
- Snippets stored in a `Map<normalised_url, snippet>` for later fallback use

**Deduplication:**
- URLs normalised: remove `www.`, trailing slashes, query params, fragments
- Deduplicated by normalised URL
- Raw hits (~2000+) reduce to ~200+ unique URLs

**API calls in Step 2:**
- Serper searches: 300–400+ queries
- OpenAI GPT-4o-mini: 4 calls (purpose seeds, associative gap-fill, broad categories, second-pass gap-fill)

---

### Step 3: Page Extraction & Filtering
**Depends on Step 2 results**

**Purpose:** Retrieve full page content from every unique URL, applying cost-saving filters.

**Sub-steps:**

**3a — URL Filtering:**
Before spending $0.008/URL on Tavily extraction, URLs are filtered:

- **Excluded domains:** News sites (nzherald.co.nz, stuff.co.nz, rnz.co.nz), social media, Wikipedia — from `market.excludedDomains`
- **Non-grant path patterns:** 24 regex patterns that reject URLs containing paths like `/careers`, `/login`, `/privacy-policy`, `/donate`, `/annual-report`, `/shop`, etc.
- **Curated URLs bypass all filters** (they're hand-verified)

**3b — Region Filtering (Curated URLs):**
- Curated funder URLs in the market config can have `regions` tags
- Only curated URLs with matching regions (or no region tag = national) are included
- Example: Foundation North (tagged `['auckland', 'northland']`) only included if user selected Auckland or Northland

**3c — Per-Domain Cap:**
- Maximum 3 URLs per domain to prevent over-extraction from a single funder's website
- Excess URLs silently dropped

**3d — Tavily Content Extraction:**
- Remaining URLs sent to Tavily API in batches of 20
- 8 concurrent batch operations
- Each page content truncated to 8000 characters
- Returns `{ url, content }` pairs

**3e — Fallback: Search-Based Recovery:**
- For URLs where Tavily extraction failed (JS-heavy sites, bot blocking, timeouts):
  1. Group failed URLs by domain
  2. Run `site:{domain} grants apply funding` search via Serper (5 results)
  3. If results have snippet >100 chars, add as page content

**3f — Fallback: Snippet Promotion:**
- For still-unextracted URLs: if the original Serper snippet from Step 2 is >200 characters, use it as page content

**3g — Enriched DB Funder Injection:**
- Charities from the database that have a pre-processed `grant_summary` are injected as synthetic pages
- Format: `{name}\n\n{grant_summary}\n\nRegistered purpose: {purpose}`
- These completely bypass Tavily (no $0.008 cost)

**API calls in Step 3:**
- Tavily extract: 100–200 URLs (~$0.80–$1.60)
- Serper searches: ~10–50 recovery searches for failed extractions

---

### Step 4: GPT Grant Extraction
**Depends on Step 3 results**

**Purpose:** Parse extracted page content to identify specific grant programs.

**Process:**
1. Pages re-filtered through `isGrantPage()` (safety net)
2. Pages batched into groups of 4 (to fit in GPT-4o-mini's context)
3. Each batch sent to GPT-4o-mini with the `PAGE_EXTRACTION_PROMPT`
4. 15 concurrent GPT calls

**Extraction rules (enforced by prompt):**
- Error pages (404, access denied) → return `[]`
- News articles/press releases → only extract if a direct funder URL is found in the content
- Past recipient lists → extract only the parent program name, not individual recipients
- Only skip grants that are: (a) exclusively for businesses/government, or (b) explicitly restricted to another country
- Extract ALL grants regardless of apparent relevance — scoring handles fit assessment
- Closed grants with past closing dates → skip; no date mentioned → include (assume rolling)

**Per grant extracted:**
```json
{
  "name": "Specific Grant Program Name",
  "funder": "Current Organisation Name",
  "type": "Government|Foundation|Corporate|Community|International|Other",
  "description": "2-3 sentences: what this program funds and who is eligible",
  "amountMin": 5000,
  "amountMax": 50000,
  "url": "https://exact-url-for-this-grant",
  "pageContent": "verbatim 1500-char excerpt covering eligibility, purpose, deadline, amounts"
}
```

**Deduplication:**
- By composite key: `funder.toLowerCase() + '||' + name.toLowerCase()`
- Prevents the same grant appearing from different search paths

**API calls in Step 4:**
- OpenAI GPT-4o-mini: ~30–50 calls (depends on page count ÷ 4)

---

### Step 5: Intelligent Scoring
**Depends on Step 4 results**

**Purpose:** Score every discovered grant on three dimensions for the specific organisation.

**Process:**
1. Grants batched into groups of 25 (to fit GPT-4o's 16k token output limit)
2. Each batch sent to GPT-4o with the `SCORING_SYSTEM_PROMPT`
3. 15 concurrent GPT calls
4. First batch also generates `orgSummary` (2–3 sentence description of the org)

**Pre-scoring checks (in order):**

1. **URL Quality Check:** If page content reads like a news article rather than an actual grant page → zero out all scores
2. **Geographic Eligibility Check:** If grant is restricted to another country → set alignment=0, attainability=0, overall=0
3. **Regional Relevance:** If a local funder serves a region the org doesn't operate in → reduce attainability by 3–4 points

**Scoring dimensions:**

| Dimension | Weight | Scale | Interpretation |
|-----------|--------|-------|----------------|
| `alignment` | 50% | 0–10 | How well the grant purpose matches the org's mission AND specific funding request. 0–3: poor match, 4–6: partial overlap, 7–8: good match, 9–10: designed for exactly this |
| `attainability` | 30% | 0–10 | Likelihood the org wins given competition and eligibility fit. 1–2: very competitive/national, 3–4: competitive, 5–6: moderate, 7–8: regional/less competitive, 9–10: strong match, few applicants |
| `ease` | 20% | 0–10 | Application complexity (higher = simpler). 1–2: multi-stage with site visits, 3–4: complex/extensive, 5–6: full proposal, 7–8: moderate effort, 9–10: simple online form |

**Overall score formula:**
```
overall = (alignment × 0.5) + (attainability × 0.3) + (ease × 0.2)
```
Rounded to 1 decimal place.

**Per grant output:**
```json
{
  "id": "g-1",
  "name": "...", "funder": "...", "type": "...", "description": "...",
  "amountMin": 5000, "amountMax": 50000,
  "deadline": "2026-09-30",
  "url": "...",
  "scores": { "alignment": 8, "ease": 6, "attainability": 6, "overall": 7.2 },
  "alignmentReason": "Why this grant fits the org's mission",
  "applicationNotes": "What the application process involves",
  "attainabilityNotes": "Competition level and org's chances"
}
```

**Deadline extraction rule:** Only future dates explicitly stated as closing/application dates. Past dates or no date → omit (assume rolling/open).

**Post-scoring filter:** Only grants with `alignment >= 5` are included in the response.

**Fallback:** If GPT doesn't calculate `overall`, the server computes it using the formula above.

**API calls in Step 5:**
- OpenAI GPT-4o: ~2–8 calls (depends on grant count ÷ 25)

---

## 6. Results Display

The results page (`app/results/page.tsx`) reads from `sessionStorage` and provides:

**Display features:**
- Grants sorted by overall score (descending) by default
- Grouped by funder + grant type with colour-coded type badges (Government=blue, Foundation=violet, Corporate=orange, Community=emerald, International=indigo)
- Circular progress rings for each score dimension, colour-coded:
  - Green: ≥ 8.0
  - Amber: ≥ 6.5
  - Orange: ≥ 5.0
  - Red: < 5.0
- Expandable detail cards showing: alignment reasoning, application notes, attainability notes, deadline, funding range

**Interactive features:**
- Sort by: overall score, alignment, attainability, ease, deadline
- Sort direction: ascending/descending
- Filter by: grant type, score threshold, funder name
- Text search across grant names
- Bookmark individual grants
- Save entire search to localStorage (with auto-generated or custom name)

**Saved searches** (`app/saved/page.tsx`):
- Lists all previously saved searches from localStorage
- Each saved search stores: org summary, grant array, search timestamp, original inputs
- Can reload a saved search or delete it

---

## 7. All External API Calls

### OpenAI API

| Step | Model | Purpose | Max Tokens | Temp | Calls |
|------|-------|---------|------------|------|-------|
| 0c | GPT-4o-mini | Discover additional grant directories | 600 | 0.2 | 1 |
| 1b | GPT-4o | Funder enumeration (per category group) | 14,000 | 0.3 | 7 |
| 1d | GPT-4o | Program enumeration | 3,000 | 0.4 | 1 |
| 2 | GPT-4o-mini | Purpose-driven seed queries | 800 | 0.4 | 1 |
| 2 | GPT-4o-mini | Regional search queries | 1,400 | 0.3 | 1 |
| 2 | GPT-4o-mini | Associative gap-fill queries | 800 | 0.4 | 1 |
| 2b | GPT-4o-mini | Second-pass gap-fill queries | 1,500 | 0.5 | 1 |
| 4 | GPT-4o-mini | Grant extraction from pages | 8,000 | 0.1 | 30–50 |
| 5 | GPT-4o | Grant scoring | 16,000 | 0.1 | 2–8 |

**All calls use `response_format: { type: 'json_object' }` for structured output.**

### Serper API (Google Search)

| Step | Purpose | Queries per search |
|------|---------|-------------------|
| 0b | Site: searches within grant directories | 100–200 |
| 0c | Validate GPT-suggested directories | 5–8 |
| 2 | Enumerated funder searches | 80–150 |
| 2 | Enumerated program searches | 40–50 |
| 2 | Static seed queries | 8 |
| 2 | Purpose-driven seed queries | 10 |
| 2 | Regional queries | 20–30 |
| 2 | Associative queries | 10–15 |
| 2 | Broad category searches | 50+ |
| 2 | Directory deep-dives | 12 |
| 2b | Second-pass gap-fill | 20–25 |
| 2c | Per-funder site crawl | 40–100+ |
| 3e | Failed extraction recovery | 10–50 |
| **Total** | | **~300–400+** |

**Endpoint:** `POST https://google.serper.dev/search`
**Headers:** `X-API-KEY`, `Content-Type: application/json`
**Body:** `{ q, num, gl, tbs }` — `gl` sets country (e.g. `'nz'`), `tbs: 'qdr:y'` for recent-only
**Client-side domain filtering** applied after response (excludes news/social media domains)

### Tavily API

| Step | Purpose | URLs |
|------|---------|------|
| 0a | Extract grant directory pages | 12 |
| 1a | Extract org website | 1 |
| 3d | Extract funder/grant pages | 100–200 |
| **Total** | | **~115–215** |

**Method:** `tavilyClient.extract(urls[])`
**Returns:** `{ results: [{ url, rawContent }] }`
**Content truncated to 8000 chars per page**

### Neon Postgres

| Step | Purpose | Queries |
|------|---------|---------|
| 1c | Full-text search for matching charities | 1 |

---

## 8. Database Layer

### Schema

```sql
CREATE TABLE charities (
  id              SERIAL PRIMARY KEY,
  charity_number  VARCHAR UNIQUE,
  name            TEXT,
  website_url     TEXT,
  purpose         TEXT,
  sector_id       INTEGER,
  grant_url       TEXT,           -- Direct URL to funder's grants page
  grant_summary   TEXT,           -- Pre-processed grant description
  enriched_at     TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Full-text search index
CREATE INDEX idx_charities_fts ON charities
  USING GIN (to_tsvector('english', name || ' ' || COALESCE(purpose, '')));
```

### Sector Mapping

The NZ Charities Register uses numeric sector IDs. The app maps them:

| Register ID | App Sector |
|-------------|-----------|
| 1 | housing |
| 2 | arts-culture |
| 4 | community |
| 5 | disability |
| 7 | education |
| 8 | community |
| 10 | environment |
| 12 | health |
| 16 | social-services |
| 17 | sport |

### Query Logic

1. Map user's selected sectors → Register sector IDs
2. Build full-text search query: purpose keywords (>3 chars, max 10) + region names (spaces removed)
3. Combine with OR: `sector_id = ANY($1) OR tsvector @@ tsquery`
4. Order by `ts_rank` (relevance) descending
5. Limit to 200 results
6. If no DB configured (`DATABASE_URL` not set), gracefully return `[]`

---

## 9. Filtering & Deduplication Logic

### URL Normalisation
```
Remove www. prefix → lowercase hostname → remove trailing slashes → remove query params → remove fragments
Example: "https://www.Example.com/Grants/?q=1#top" → "example.com/grants"
```

### URL Deduplication
Applied at multiple stages — deduplicated by normalised URL. First occurrence wins.

### Grant Deduplication
Composite key: `funder.toLowerCase().trim() + '||' + name.toLowerCase().trim()`

### Non-Grant URL Filter
24 regex patterns reject URLs containing paths like:
- `/press-release`, `/media-release`, `/blog/`
- `/login`, `/signin`, `/register`, `/signup`
- `/privacy-policy`, `/terms-of-use`, `/cookie-policy`
- `/careers`, `/jobs`, `/vacancies`
- `/sitemap`, `/feed`, `/rss`, `/wp-json/`
- `/annual-report`, `/financial-statements`
- `/shop`, `/cart`, `/checkout`, `/donate`

### Domain Exclusion
News/social media domains blocked from search results:
`nzherald.co.nz`, `stuff.co.nz`, `rnz.co.nz`, `scoop.co.nz`, `newshub.co.nz`, `tvnz.co.nz`, `beehive.govt.nz`, `charities.govt.nz`, `grantguru.co.nz`, `wikipedia.org`, `linkedin.com`, `facebook.com`, `twitter.com`, `youtube.com`, `reddit.com`

### Per-Domain Cap
Maximum 3 URLs per funder domain during extraction. Prevents one large funder site from consuming all extraction budget.

---

## 10. Scoring Algorithm

```
                    ┌─────────────────────────────────────────┐
                    │           Pre-Scoring Checks             │
                    │                                         │
                    │  1. URL Quality: news article?           │
                    │     → Yes: all scores = 0               │
                    │                                         │
                    │  2. Geographic Eligibility: wrong        │
                    │     country?                             │
                    │     → Yes: alignment=0, attainability=0 │
                    │                                         │
                    │  3. Regional: wrong region?              │
                    │     → Yes: attainability -= 3 to 4      │
                    └─────────────────┬───────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────────┐
                    │           Score Calculation               │
                    │                                         │
                    │  alignment (0-10)     × 0.5 ──┐         │
                    │  attainability (0-10) × 0.3 ──┼→ overall│
                    │  ease (0-10)          × 0.2 ──┘         │
                    │                                         │
                    │  overall = round to 1 decimal place     │
                    └─────────────────┬───────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────────┐
                    │           Post-Scoring Filter            │
                    │                                         │
                    │  alignment < 5 → EXCLUDED from results  │
                    │  alignment ≥ 5 → INCLUDED                │
                    └─────────────────────────────────────────┘
```

---

## 11. Cost Tracking

The server tracks every API call and computes a cost breakdown:

| Component | Unit Price | Typical Usage | Est. Cost |
|-----------|-----------|---------------|-----------|
| GPT-4o input tokens | $2.50/M | ~300k tokens | ~$0.75 |
| GPT-4o output tokens | $10.00/M | ~100k tokens | ~$1.00 |
| GPT-4o-mini input tokens | $0.15/M | ~200k tokens | ~$0.03 |
| GPT-4o-mini output tokens | $0.60/M | ~50k tokens | ~$0.03 |
| Tavily URL extractions | $0.008/URL | ~150 URLs | ~$1.20 |
| Serper search queries | $0.001/query | ~400 queries | ~$0.40 |
| **Total per search** | | | **~$3.40** |

Cost breakdown is logged to the server console after every search.

---

## 12. Rate Limiting & Retry Logic

### Retry with Exponential Backoff (`withRetry`)
- Retries on HTTP 429 (rate limited) up to 4 times
- Reads `retry-after-ms` or `retry-after` headers
- Falls back to exponential backoff: 2s, 4s, 8s, 16s
- Maximum wait: 30 seconds per retry
- All other HTTP errors are thrown immediately

### Concurrency Control (`withConcurrency`)
- Generic worker pool pattern: N workers pull from a shared task queue
- Used with different limits per operation:

| Operation | Concurrency Limit |
|-----------|------------------|
| Serper search queries | 20 |
| Tavily extract batches | 8 |
| GPT grant extraction | 15 |
| GPT scoring | 15 |
| Additional directory validation | 5 |
| Failed extraction recovery | 10 |

---

## 13. Assumptions

1. **GPT knowledge is comprehensive but not authoritative:** The funder enumeration relies on GPT's training data. Non-existent funders are self-correcting (their Serper search returns no results), but recently created funders may be missed.

2. **Web pages are scrapable:** Assumes most funder websites serve readable HTML. JS-heavy SPAs and bot-blocking sites fall back to search snippets.

3. **Grant pages follow common URL patterns:** The URL filter assumes grants pages don't live under paths like `/careers`, `/login`, etc. Curated URLs bypass this assumption.

4. **Rolling/open grants are common:** If no closing date is found, the grant is assumed to be rolling or annually recurring — it's included, not excluded.

5. **NZD pricing assumed for NZ market:** All amounts formatted as NZD with NZ locale.

6. **User's organisation is a legitimate nonprofit:** The scoring prompt assumes the user is from a registered charity, charitable trust, or similar entity.

7. **Market config is authoritative for regions:** The 17 NZ regions listed in the market config are treated as the complete set.

8. **Database availability is optional:** If `DATABASE_URL` is not set, the charities database lookup is silently skipped. The system functions without it.

9. **Single search per user at a time:** The pipeline is not designed for concurrent searches from the same user session.

10. **Tavily extraction failure is not fatal:** Multiple fallback layers (search snippets, snippet promotion, DB injection) ensure content is available even when primary extraction fails.

---

## 14. Constraints & Limitations

1. **No authentication:** The app is fully public with no user accounts or login.

2. **Client-side storage only:** Results stored in `sessionStorage` (lost on tab close). Saved searches use `localStorage` (persists but local to the device/browser).

3. **No server-side persistence of results:** The server computes and returns results but doesn't store them. If the browser tab closes during search, results are lost.

4. **2–3 minute search time:** The multi-step pipeline is inherently slow. Users see a progress overlay with 9 loading stages.

5. **~$3–4 per search in API costs:** Every search costs money. There's no caching of results across users.

6. **Australia market is scaffolded but incomplete:** The AU market config exists but has empty `curatedFunderUrls` and hasn't been validated.

7. **Relevance triage is disabled:** Step 4.5 (pre-scoring relevance filter) was filtering too aggressively and is currently disabled. All extracted grants go directly to scoring.

8. **No real-time grant monitoring:** Results are a point-in-time snapshot. Grants may open/close after the search.

9. **Token limit truncation:** GPT responses may be truncated if they exceed `max_tokens`. The funder enumeration has regex recovery; other steps may lose the last few entries in a batch.

10. **Per-domain cap of 3:** Large funders with many programs on different sub-pages may have programs missed due to the 3 URL per domain cap.

11. **Search snippet fallback is lossy:** When full page extraction fails, search snippets (typically 150–300 chars) provide much less information for grant extraction than full page content (8000 chars).

12. **Vercel function timeout:** The pipeline must complete within Vercel's function timeout (varies by plan: 10s hobby, 60s pro, 300s enterprise).

13. **No PDF extraction:** Grant information in PDF documents (common for government grants) cannot be extracted by Tavily.

---

## 15. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for GPT-4o and GPT-4o-mini |
| `TAVILY_API_KEY` | Yes | Tavily API key for web content extraction |
| `SERPER_API_KEY` | Yes | Serper.dev API key for Google Search queries |
| `DATABASE_URL` | No | Neon Postgres connection string |
| `POSTGRES_URL` | No | Alternative name for `DATABASE_URL` |

---

## 16. Process Flow Diagram (Detailed)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ USER SUBMITS SEARCH FORM                                                           │
│ POST /api/search { website, fundingPurpose, fundingAmount, market, regions, ... }   │
└───────────────────────────────────────┬─────────────────────────────────────────────┘
                                        │
                                        ▼
                              ┌─────────────────────┐
                              │  Validate inputs     │
                              │  Resolve market      │
                              │  config (NZ/AU)      │
                              │  Map region IDs →    │
                              │  names               │
                              │  Map sector IDs →    │
                              │  labels              │
                              │  Build prompts       │
                              │  Init cost tracker   │
                              └──────────┬──────────┘
                                         │
            ┌────────────────────────────┼────────────────────────────┐
            │                            │                            │
            ▼                            ▼                            ▼
   ┌─────────────────┐       ┌───────────────────┐       ┌───────────────────┐
   │ STEP 0           │       │ STEP 1             │       │ PARALLEL           │
   │ Directory Mining │       │ Org + Funders      │       │                   │
   │                  │       │                    │       │ Regional Queries  │
   │ 0a: Extract 12   │       │ 1a: Tavily extract │       │ (GPT-4o-mini)     │
   │ directory pages  │       │ org website        │       │ 20-30 queries     │
   │ (Tavily)         │       │                    │       │                   │
   │                  │       │ 1b: 7× GPT-4o     │       │ DB Funder Lookup  │
   │ 0b: Site:domain  │       │ funder enum calls  │       │ (Neon Postgres)   │
   │ searches (~150)  │       │ (80-150 funders)   │       │ Up to 200 matches │
   │ (Serper)         │       │                    │       │                   │
   │                  │       │ 1d: 1× GPT-4o     │       └───────────────────┘
   │ 0c: GPT discover │       │ program enum       │
   │ + validate dirs  │       │ (40-50 programs)   │
   │ (GPT-4o-mini +   │       │                    │
   │  Serper)          │       └────────┬──────────┘
   └────────┬─────────┘                │
            │                           │
            └───────────┬───────────────┘
                        │
                        ▼
              ┌───────────────────┐
              │ MERGE RESULTS     │
              │                   │
              │ • Merge + dedup   │
              │   enumerated      │
              │   funders         │
              │ • Split DB funders│
              │   (enriched vs    │
              │   unenriched)     │
              │ • Cap total URLs  │
              │   at 200          │
              └────────┬──────────┘
                       │
     ┌─────────────────┼──────────────────────────────┐
     │                 │                               │
     ▼                 ▼                               ▼
┌──────────┐   ┌──────────────────┐          ┌──────────────────┐
│ Purpose  │   │ STEP 2            │          │ Associative      │
│ Seeds    │   │ Enum + Seed       │          │ Gap-Fill         │
│ GPT-4o-  │   │ Searches          │          │ GPT-4o-mini      │
│ mini     │   │                   │          │ 10-15 queries    │
│ 10 qs    │   │ 80-150 funder     │          └────────┬─────────┘
└─────┬────┘   │ 40-50 program     │                   │
      │        │ 8 seed            │                   │
      │        │ 20-30 regional    │                   │
      │        │ 12 directory      │                   │
      │        └────────┬──────────┘                   │
      │                 │                               │
      │        ┌────────┼───────────────────────────────┘
      │        │        │
      ▼        ▼        ▼
┌───────────────────────────────────────────┐
│ STEP 2 (continued)                        │
│                                           │
│ Run ALL search batches with               │
│ concurrency = 20:                         │
│                                           │
│ • Purpose seed queries (10)               │
│ • Associative queries (10-15)             │
│ • Broad category queries (50+)            │
│                                           │
│ All → Serper → rawSearchHits[]            │
└──────────────────┬────────────────────────┘
                   │
                   ▼
┌───────────────────────────────────────────┐
│ STEP 2b: Gap-Fill                         │
│                                           │
│ Analyse found domains → GPT-4o-mini       │
│ generates 20-25 second-pass queries       │
│ → Serper searches                         │
└──────────────────┬────────────────────────┘
                   │
                   ▼
┌───────────────────────────────────────────┐
│ STEP 2c: Per-Funder Site Crawl            │
│                                           │
│ For each unique funder domain:            │
│ site:{domain} "grants apply"              │
│ site:{domain} "funding apply"             │
│ site:{domain} "community grants"          │
│ site:{domain} "grant application"         │
│ → 40-100+ additional Serper queries       │
└──────────────────┬────────────────────────┘
                   │
                   ▼
┌───────────────────────────────────────────┐
│ DEDUPLICATE                               │
│                                           │
│ ~2000+ raw hits → ~200+ unique URLs       │
│ Build snippet fallback map                │
└──────────────────┬────────────────────────┘
                   │
                   ▼
┌───────────────────────────────────────────┐
│ STEP 3: Page Extraction                   │
│                                           │
│ 3a: Filter non-grant URLs (24 patterns)   │
│ 3b: Region-filter curated URLs            │
│ 3c: Per-domain cap (max 3/domain)         │
│ 3d: Tavily extract (batches of 20)        │
│ 3e: Fallback: site: search for failures   │
│ 3f: Fallback: promote long snippets       │
│ 3g: Inject enriched DB funders            │
│                                           │
│ Result: 150-200+ pages with content       │
└──────────────────┬────────────────────────┘
                   │
                   ▼
┌───────────────────────────────────────────┐
│ STEP 4: Grant Extraction                  │
│                                           │
│ Pages batched (4 per call)                │
│ → GPT-4o-mini extracts grant programs     │
│ → Deduplicate by funder+name              │
│                                           │
│ Result: 50-200 unique grants              │
└──────────────────┬────────────────────────┘
                   │
                   ▼
┌───────────────────────────────────────────┐
│ STEP 5: Scoring                           │
│                                           │
│ Grants batched (25 per call)              │
│ → GPT-4o scores each grant               │
│                                           │
│ Pre-checks: URL quality, geo eligibility, │
│ regional relevance                         │
│                                           │
│ Scores: alignment × 0.5                   │
│       + attainability × 0.3               │
│       + ease × 0.2                         │
│       = overall                            │
│                                           │
│ Filter: alignment ≥ 5 only                │
│                                           │
│ First batch also generates orgSummary     │
└──────────────────┬────────────────────────┘
                   │
                   ▼
┌───────────────────────────────────────────┐
│ BUILD RESPONSE                            │
│                                           │
│ {                                         │
│   grants: GrantOpportunity[],             │
│   orgSummary: string,                     │
│   searchedAt: ISO timestamp,              │
│   market: "nz",                           │
│   inputs: OrgInfo                         │
│ }                                         │
│                                           │
│ Log cost breakdown to console             │
│ Return JSON response                      │
└──────────────────┬────────────────────────┘
                   │
                   ▼
┌───────────────────────────────────────────┐
│ BROWSER                                   │
│                                           │
│ Store response in sessionStorage          │
│ Navigate to /results                      │
│ Render grants with scores + details       │
│ User can filter, sort, bookmark, save     │
└───────────────────────────────────────────┘
```

---

## Appendix: Market Configuration (NZ)

The NZ market config (`lib/markets/nz.ts`) provides:

- **17 regions:** Northland through Chatham Islands
- **19 funder type hints** (grouped into 7 parallel enumeration calls)
- **12 grant directories** (fundinginformation.org.nz, communitymatters.govt.nz, etc.)
- **200+ curated funder URLs** spanning:
  - Government grant programs (25+)
  - Gaming trusts (13)
  - Community/regional trusts (20+)
  - Community foundations (15+)
  - Charitable/philanthropic trusts (15+)
  - Health/research trusts (4)
  - Environment/conservation (2)
  - Iwi/Maori trusts (3)
  - Corporate foundations & CSR (15+)
  - City councils (13)
  - District councils (40+)
  - Regional councils (9)
- **8 seed query templates**
- **15 excluded domains** (news sites, social media)
- Many curated URLs include `regions` tags for geographic filtering
