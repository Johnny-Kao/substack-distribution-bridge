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

- Workers AI screening reads full article excerpts only. It uses the JSON-Mode supported `@cf/meta/llama-3.1-8b-instruct` model with strict verdict validation and a privacy-safe error category. Malformed output leaves the article in the pending queue instead of recording a fabricated evaluation.
- Each scheduled search must distinguish successful discovery, exhausted free-browser capacity, AI deferred by daily cap, and genuine upstream errors. Do not equate a zero-result page with success if the upstream request failed.
- Actions are read-only until an exact author-approved target and content are provided. Never publish based on automated discovery scores alone; protect against duplicates and ambiguous retries.
- Cloudflare free-browser budget and a D1 request pacing gate protect against paid overflow.

## Evidence

- 2026-10-24 cloud comment acceptance: [GitHub Actions #40048519286](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40048519286), published once and exact-account/body verified.
- Previous global search persisted over 170 post records in private D1, but an AI screening error caused a scheduled job to fail; see Global Discovery workflow for the current acceptance history.
- Browser access, AI evaluation, private state readback and public interaction are tested **separately**. One green check does not establish complete unattended operation.

Read `AGENTS.md` and `SOP.md` for privacy and execution controls.
