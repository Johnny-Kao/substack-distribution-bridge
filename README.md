# Substack Distribution Bridge

Privacy-first Substack discovery pipeline using only GitHub Actions, Cloudflare Worker, Workers AI and D1. No local computer or external paid service is required for the deployed control plane.

## Current capabilities
- Scheduled read-only discovery and QC via GitHub Actions. Public RSS is retrieved by the existing Cloudflare Worker through its first-party Browser Run binding (within the free allowance), not direct GitHub-to-Substack requests. One source is read hourly.
- A separate GitHub workflow runs one **authenticated, read-only subject search step** every three hours using private Cloudflare settings. The Worker keeps pagination position, deduplicates publication IDs/subdomains in D1, and feeds newly found sources into the regular article/engagement-candidate pipeline. No subject, identity, or publication list is exposed in public GitHub logs.
- Browser Run is rate-limited across both discovery workflows using one atomic D1 gate (15-second spacing, at most 38 actions and 390 seconds accounted browser usage in 24 hours), with no paid overflow.
- Upstream access failures are reported as failures, **not** successful zero-result scans.
- All private data is stored in Cloudflare and is not printed in Actions output.
- Cloudflare bridge credentials are held in Secrets.
- Private editorial AI drafts, proposal hashes and manual batch approval remain in Cloudflare D1. These operations **do not publish** to Substack.
- Discovery candidates now preserve excerpts, subject-fit signals, priority scores, and possible Like/comment *review* actions in a private engagement queue. Semantic review generates rationale and discussion angles, not publication approval.
- M5 research proved multi-page topic search and cross-query dedup. `scripts/subject_search.py` is the portable test helper. Cloudflare's production version now uses a persistent, one-page-per-run search cursor and D1 source pool, to fit Free plan browser limits.
- The owner-only **read-only** subject-probe endpoint remains available for diagnostics. Cloudflare subject-search returned 17 publications in a live test; the new source pool subsequently returned a valid RSS with five posts.
- Direct authenticated Substack requests from Workers returned HTTP 429, and GitHub-hosted direct RSS returned HTTP 403. The read-only Browser Run RSS path returned real XML over HTTPS and successfully populated D1 in a local end-to-end test. Authenticated social actions remain unverified.
- **Public Likes, Comments and Notes are disabled**. Finding publications is not equivalent to validating author relevance, commentability, previous reactions or publish permissions. Do not claim unattended publication or a complete engagement workflow.
- No M5 LaunchAgent, runner credential or external hosting is part of the production architecture.

## Acceptance
- Discovery cannot be marked PASS if it fetched zero articles while private source configuration is present.
- HTTP 403/429 is recorded in private D1 and surfaces as a failed Discovery run; no automatic cooldown is applied during integration testing. Each run makes only bounded requests; data is retained.
- Public posting requires separately demonstrated supported write access, exact-target approvals, idempotency and readback before any future activation.

## Agent interoperability
AI clients can read the public SOP and workflow code using GitHub MCP. Public repository, Issues, and Actions are **not** private communication channels and must not be used to transmit operational contents, even encrypted. Private state query transport must be separately authorized and privacy-reviewed before activation.

See AGENTS.md and SOP.md.
