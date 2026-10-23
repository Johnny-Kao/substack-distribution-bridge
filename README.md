# Substack Distribution Bridge

Privacy-first Substack discovery pipeline using only GitHub Actions, Cloudflare Worker, Workers AI and D1. No local computer or external paid service is required for the deployed control plane.

## Current capabilities
- The primary global content workflow runs every three hours, searches one page of cross-publication Substack Posts, and persists canonical post IDs, author publication identifiers, excerpts and engagement metadata in private D1. Search cycles use at most five pages (100 results) per subject, with deduplication and low-yield early stopping.
- Each global workflow also opens one actual post by ID through Browser Run, reads its available article body, then performs one bounded Workers AI semantic review. A search preview alone is not sufficient for semantic acceptance. No public interactions are executed.
- Supplemental public RSS discovery runs every three hours; authenticated publication discovery runs every 12 hours. All Browser Run uses share an atomic D1 gate (minimum 15-second spacing, at most 38 actions and 390 seconds accounted usage in 24 hours), without paid overflow.
- Upstream access failures are reported as failures, **not** successful zero-result scans.
- All private data is stored in Cloudflare and is not printed in Actions output.
- Cloudflare bridge credentials are held in Secrets.
- Private editorial AI drafts, proposal hashes and manual batch approval remain in Cloudflare D1. These operations **do not publish** to Substack.
- Discovery candidates now preserve excerpts, subject-fit signals, priority scores, and possible Like/comment *review* actions in a private engagement queue. Semantic review generates rationale and discussion angles, not publication approval.
- M5 research established cross-publication post search using `/api/v1/post/search`, separate from `/api/v1/publication/search`. Cloudflare stores the global search cursor and runs one page per invocation.
- The owner-only **read-only** subject-probe endpoint remains available for diagnostics. Cloudflare subject-search returned 17 publications in a live test; the new source pool subsequently returned a valid RSS with five posts.
- Direct authenticated Substack requests from Workers returned HTTP 429, and GitHub-hosted direct RSS returned HTTP 403. The read-only Browser Run RSS path returned real XML over HTTPS and successfully populated D1 in a local end-to-end test. Authenticated social actions remain unverified.
- **Public Likes, Comments and Notes are disabled**. Finding publications is not equivalent to validating author relevance, commentability, previous reactions or publish permissions. Do not claim unattended publication or a complete engagement workflow.
- No M5 LaunchAgent, runner credential or external hosting is part of the production architecture.

## Acceptance
- 2026-10-24: GitHub Actions run 39977847879 verified 20 real global search hits, 18 new posts, one full article readback and one Workers AI semantic review. Cloud D1 had 136 distinct posts after that run. This is a verified search-to-review pipeline, **not** verified public engagement.
- Global Notes search, threaded discussion understanding, external prior-interaction readback, and cloud public write transport are not accepted. Do not call the overall engagement system complete.
- Discovery cannot be marked PASS if it fetched zero articles while private source configuration is present.
- HTTP 403/429 is recorded in private D1 and surfaces as a failed Discovery run; no automatic cooldown is applied during integration testing. Each run makes only bounded requests; data is retained.
- Public posting requires separately demonstrated supported write access, exact-target approvals, idempotency and readback before any future activation.

## Agent interoperability
AI clients can read the public SOP and workflow code using GitHub MCP. Public repository, Issues, and Actions are **not** private communication channels and must not be used to transmit operational contents, even encrypted. Private state query transport must be separately authorized and privacy-reviewed before activation.

See AGENTS.md and SOP.md.
