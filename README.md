# Substack Distribution Bridge

GitHub is the public, model-independent coordination interface; Cloudflare Workers + D1 are the **private backend**. Python running in GitHub Actions performs read-only keyword discovery and deterministic pre-QC without AI tokens. No personal candidate list, engagement history, or Substack session is committed to GitHub.

## Current status
- Scheduled discovery: hourly at minute 23 UTC, with jitter; workload scaled by Japan time to emphasize Europe/US readership. Read-only, no Substack writes.
- Cloudflare gateway: stores source/keyword configuration and candidates privately. HTTP operations authenticate with an independently stored bridge credential.
- Encrypted human/agent interface: GitHub Issue #1 is an **encrypted relay**. Only encrypted commands and encrypted replies may appear on GitHub. It is intentionally disabled until a private decryption key is configured in Cloudflare.
- Likes, Comments and Notes: live writes were verified on the earlier M5-based client, but **are not enabled in this cloud deployment**.

## For another AI Agent
1. Read `AGENTS.md` and `SOP.md` using GitHub MCP.
2. Check the last Actions workflow status for basic health.
3. For private state, clone/read the public `scripts/gateway_client.py` and `gateway_public.pem`. From a Python execution environment, run:
   `uv run --no-project --with cryptography python -m scripts.gateway_client create status`
4. Post the resulting `enc-v1:...` string verbatim as a comment to [Issue #1](https://github.com/Johnny-Kao/substack-distribution-bridge/issues/1) using GitHub MCP, as the authorized repository owner.
5. Once a `github-actions[bot]` encrypted reply appears, run
   `uv run --no-project --with cryptography python -m scripts.gateway_client decrypt 'enc-v1:...'`
   from **the same execution environment**. The reply private key is short-lived and saved only in an ignored local `.cache/` file.
6. The other permitted read-only commands are `shortlist` (optionally followed by a maximum of 1–25) and `policy`. Never submit plaintext requests or results to GitHub.

Encryption alone does not hide metadata such as the existence, timing, or author of a GitHub comment. This is an intentional tradeoff. It does protect the candidate contents from normal public browsing.

## Security boundaries
- Public GitHub: generic code, public SOP, Actions status, opaque encrypted messages.
- Private Cloudflare: Substack credentials when separately configured, source/keyword configuration, candidate content, operation history.
- All remote writes remain off until exact approval + unique operation IDs + readback verification are independently tested.
- Do not use automation to bypass third-party policies or rate limits.
