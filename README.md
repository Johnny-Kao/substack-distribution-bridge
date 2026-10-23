# Substack Distribution Bridge

Privacy-first Substack discovery pipeline. GitHub Actions runs periodic keyword discovery and deterministic Python pre-QC without AI tokens. Cloudflare Worker and private D1 database store sources, personalized keywords, article candidates, and history.

## Current capabilities
- Scheduled read-only discovery and QC via GitHub Actions, with randomized scheduling offsets.
- All private data is stored in Cloudflare and is not printed in Actions output.
- Cloudflare bridge credentials are held in Secrets.
- Substack's Cloudflare edge currently refuses authenticated direct Worker requests (HTTP 429). The private Cloudflare approval queue therefore uses a separately authenticated **M5 pull runner**, rather than making direct Worker-to-Substack write requests.
- The M5 runner claims only specifically approved manual proposals, verifies SHA-256 approval hashes, checks existing Likes, writes through the already tested local Substack client, and reports verified or unknown status. Errors halt further work.
- Automatic QC-triggered Likes are **not yet active**; the live private runner handles explicitly approved jobs only.

## M5 one-time runner setup
The runtime is staged in `~/Library/Application Support/SubstackBridge` rather than `Downloads`, because background Python startup was blocked when installed under the protected Downloads directory.

With direct access to the M5 Terminal, run:

```bash
cd ~/Downloads/Coding/substack-ops/distribution-deploy
python3 scripts/install_m5_runner.py
```

This locally copies the existing Substack session, runtime configuration, and independent runner key into the application support directory without printing them; verifies both Cloudflare and Substack authentication; and installs a 300-second macOS LaunchAgent. The remote assistant cannot transfer these session files due to tool safety controls. No public interaction is created by installation. Never commit any runtime credential files.

## Agent interoperability
AI clients can read the public SOP and workflow code using GitHub MCP. Public repository, Issues, and Actions are **not** private communication channels and must not be used to transmit operational contents, even encrypted. Private state query transport must be separately authorized and privacy-reviewed before activation.

See AGENTS.md and SOP.md.
