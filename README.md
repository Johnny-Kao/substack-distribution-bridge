# Substack Distribution Bridge

Privacy-first Substack discovery pipeline. GitHub Actions runs periodic keyword discovery and deterministic Python pre-QC without AI tokens. Cloudflare Worker and private D1 database store sources, personalized keywords, article candidates, and history.

## Current capabilities
- Scheduled read-only discovery and QC via GitHub Actions, with randomized scheduling offsets.
- All private data is stored in Cloudflare and is not printed in Actions output.
- Cloudflare bridge credentials are held in Secrets.
- Public interaction writes (Likes, Comments, Notes) remain disabled pending explicit per-operation authorization and remote readback verification.

## Agent interoperability
AI clients can read the public SOP and workflow code using GitHub MCP. Public repository, Issues, and Actions are **not** private communication channels and must not be used to transmit operational contents, even encrypted. Private state query transport must be separately authorized and privacy-reviewed before activation.

See AGENTS.md and SOP.md.
