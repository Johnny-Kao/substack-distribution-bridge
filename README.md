# Substack Distribution Bridge

Cloud-only Substack discovery and supervised engagement using GitHub Actions, Cloudflare Workers, Browser Rendering, Workers AI and private D1. No personal Mac/M5 is required to run the deployed system.

## Active production architecture

- **One scheduled discovery pipeline:** `.github/workflows/global-discovery.yml`, every three hours. It searches Substack posts **across publications**, maintains private D1 cursors, deduplicates post IDs, selects candidate posts, retrieves up to two full articles and runs bounded semantic assessment.
- Cloudflare D1 stores targets, drafts, scores, outcomes, identity checks, and authorization state. GitHub logs must not expose private subjects, targets, session credentials, or unpublished drafts.
- A separately approved, single exact-comment operation has been published from Cloudflare and independently verified against the author account and post. That **does not authorize unattended commenting or posting on other articles**.
- The authenticated Like state can be read via the cloud-only Browser Session path. Posting, idempotency, and readback are separate capabilities; do not assume all write operations work from a successful read.

## Retired legacy schedules

As of 2026-10-24, the independent RSS/source-feed schedule (`discovery.yml`) and publication-only subject discovery schedule (`subject-discovery.yml`) have been deleted. They were redundant for the user's platform-wide post-search objective and competed for Browser Rendering quota.

Lower-level RSS/feed parsers and older subject-search functions remain in the repository as uninvoked utilities for compatibility and tests; **they are not production scheduled jobs**.

## Review and verification

- **Stage 1 (lightweight):** Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` evaluates up to 3,500 characters per article using a strict JSON verdict (comment / like / skip). It is a short-input first pass, **not** a full-article evaluation.\n- **Stage 2 (independent deep review):** high-score positive candidates are reviewed using their privately stored article body (up to 42,000 characters) and `@cf/openai/gpt-oss-120b`; an invalid structured output can fall back once to Llama 3.3 JSON Mode. Model-selected evidence anchor IDs resolve to literal source excerpts, eliminating fabricated quotation strings. The private D1 record stores verdict, rationale, risks, and verified source evidence. The local AI ledger allows at most 2 stage-2 attempts/24h and 8 total AI entries/24h.\n- **Current limitation:** stage 2 has no fetched discussion-thread text, so it explicitly records `discussion_context=not_fetched`. Its verdict is a research aid, not final authorization to comment. Malformed output is rejected; no public write is performed.
- Each scheduled search must distinguish successful discovery, exhausted free-browser capacity, AI deferred by daily cap, and genuine upstream errors. Do not equate a zero-result page with success if the upstream request failed.
- Actions are read-only until an exact author-approved target and content are provided. Never publish based on automated discovery scores alone; protect against duplicates and ambiguous retries.
- Cloudflare free-browser budget and a D1 request pacing gate protect against paid overflow.

## Evidence

- 2026-10-24 cloud comment acceptance: [GitHub Actions #40048519286](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40048519286), published once and exact-account/body verified.
- **2026-10-24 [GitHub Actions #40074840891](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40074840891):** live cross-publication search returned 20 posts with 14 new posts (186 total stored), 2 full-article reads, and passed all 33 Node tests. An independent stage-one AI smoke check reviewed 1 article. Stage two's real invocation was **deferred by the daily AI limit**, and the complete search batch also deferred AI after saving both articles. Therefore this is a successful **search/read pipeline**, not proof of a live completed two-stage AI review.\n- Separate stage-two local/CI tests cover actual full stored article passing, a GPT-OSS invalid-output fallback to JSON-schema Llama 3.3, exact evidence-anchor constraints, and no writes on bad outputs. A live stage-two completed verdict remains to be accepted after the AI allowance resets.
- Browser access, AI evaluation, private state readback and public interaction are tested **separately**. One green check does not establish complete unattended operation.

Read `AGENTS.md` and `SOP.md` for privacy and execution controls.
