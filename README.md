# Substack Distribution Bridge

Privacy-first Substack discovery pipeline using only GitHub Actions, Cloudflare Worker, Workers AI and D1. No local computer or external paid service is required for the deployed control plane.

## Current capabilities
- Scheduled read-only discovery and QC via GitHub Actions. Public RSS is retrieved by the existing Cloudflare Worker through its first-party Browser Run binding (available within Cloudflare's free allowance), not direct GitHub-to-Substack requests. Sources rotate hourly with additional EU/US window coverage.
- Browser usage is recorded privately in D1 and capped at 36 fetches or 300 seconds per UTC day, whichever comes first; no paid infrastructure is added.
- Upstream access failures are reported as failures, **not** successful zero-result scans.
- All private data is stored in Cloudflare and is not printed in Actions output.
- Cloudflare bridge credentials are held in Secrets.
- Private editorial AI drafts, proposal hashes and manual batch approval remain in Cloudflare D1. These operations **do not publish** to Substack.
- Discovery candidates now preserve excerpts, subject-fit signals, priority scores, and possible Like/comment *review* actions in a private engagement queue. Semantic review generates rationale and discussion angles, not publication approval.
- Direct authenticated Substack requests from Workers returned HTTP 429, and GitHub-hosted direct RSS returned HTTP 403. The read-only Browser Run RSS path returned real XML over HTTPS and successfully populated D1 in a local end-to-end test. Authenticated social actions remain unverified.
- **Public Likes, Comments and Notes are disabled**. Topic-wide discovery across authors is not yet verified. Do not claim unattended publication or a complete engagement workflow.
- No M5 LaunchAgent, runner credential or external hosting is part of the production architecture.

## Acceptance
- Discovery cannot be marked PASS if it fetched zero articles while private source configuration is present.
- HTTP 403/429 is recorded in private D1 and surfaces as a failed Discovery run; no automatic cooldown is applied during integration testing. Each run makes only bounded requests; data is retained.
- Public posting requires separately demonstrated supported write access, exact-target approvals, idempotency and readback before any future activation.

## Agent interoperability
AI clients can read the public SOP and workflow code using GitHub MCP. Public repository, Issues, and Actions are **not** private communication channels and must not be used to transmit operational contents, even encrypted. Private state query transport must be separately authorized and privacy-reviewed before activation.

See AGENTS.md and SOP.md.
