# Agent handoff contract

Goal: Work with Substack without requiring each AI client to configure the user's Cloudflare backend. GitHub MCP is an interface, not permission to reveal private state.

1. Read README.md and SOP.md.
2. GitHub contents, Issues, pull requests, workflow inputs and logs are PUBLIC. Never put session cookies, magic links, private search terms, target identities, drafts, responses or detailed interaction records into GitHub plaintext.
3. No public GitHub Issue relay is authorized for private state, whether plaintext or encrypted.
4. If private state is unavailable, report that limitation; never improvise a public-message fallback.
5. Follow deterministic QC before AI review. Use AI only for article understanding, judgment and substantive drafting.
6. Discovery and AI proposals alone never authorize public interaction. The cloud dispatcher MAY execute an individually owner-approved Like or exact approved Comment only after the approval has been durably verified in private D1, with unique operation ID and post-write readback. The SHA-256-pinned encrypted owner batch of 2026-10-25 is a narrow one-time approval, not a reusable publication credential.
7. On error or ambiguous timeout, inspect status and do not automatically repost.
8. New GitHub issues/comments must not contain any personalized operational details, even if a user is the author.
