# Substack Distribution Bridge

Privacy-first Substack discovery pipeline using only GitHub Actions, Cloudflare Worker, Workers AI and D1. No local computer or external paid service is required for the deployed control plane.

## Current capabilities
- Scheduled read-only discovery and QC via GitHub Actions with randomized scheduling offsets; upstream access failures are reported as failures, **not** successful zero-result scans.
- All private data is stored in Cloudflare and is not printed in Actions output.
- Cloudflare bridge credentials are held in Secrets.
- Private editorial AI drafts, proposal hashes and manual batch approval remain in Cloudflare D1. These operations **do not publish** to Substack.
- Direct authenticated Substack requests from Cloudflare returned HTTP 429; GitHub-hosted public RSS and profile requests returned HTTP 403. Cloudflare-hosted public RSS returned HTTP 429. A cached RSS JSON response from another Worker is not evidence of fresh upstream connectivity.
- **Public Likes, Comments and Notes are disabled**. Substack does not currently provide a generally available official write API for those operations. Do not claim unattended publication or an operational public-write workflow.
- No M5 LaunchAgent, runner credential or external hosting is part of the production architecture.

## Acceptance
- Discovery cannot be marked PASS if it fetched zero articles while private source configuration is present.
- HTTP 403/429 is recorded in private D1 and triggers a six-hour cooldown; data is retained.
- Public posting requires separately demonstrated supported write access, exact-target approvals, idempotency and readback before any future activation.

## Agent interoperability
AI clients can read the public SOP and workflow code using GitHub MCP. Public repository, Issues, and Actions are **not** private communication channels and must not be used to transmit operational contents, even encrypted. Private state query transport must be separately authorized and privacy-reviewed before activation.

See AGENTS.md and SOP.md.
