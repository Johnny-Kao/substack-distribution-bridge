# Agent handoff contract

Goal: Work with Substack without requiring each AI client to configure the user's Cloudflare backend. GitHub MCP is an interface, not permission to reveal private state.

1. Read README.md and SOP.md.
2. GitHub contents, Issues, pull requests, workflow inputs and logs are PUBLIC. Never put session cookies, magic links, private search terms, target identities, drafts, responses or detailed interaction records into GitHub plaintext.
3. For private state, use only the encrypted Issue #1 relay. Generate a new ephemeral response key with the public helper; the secret portion must not be committed or shared.
4. If the relay is not ready, report it. Never improvise plaintext fallback.
5. Follow deterministic QC before AI review. Use AI only for article understanding, judgment and substantive drafting.
6. No public interaction by automation in the current cloud deployment. Proposals are not approvals.
7. On error or ambiguous timeout, inspect status and do not automatically repost.
8. New GitHub issues/comments must not contain any personalized operational details, even if a user is the author.
