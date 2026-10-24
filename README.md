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

- **Stage 1 (lightweight):** Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` evaluates up to 3,500 characters per article using a strict JSON verdict (comment / like / skip). It is a short-input first pass, **not** a full-article evaluation.\n- **Stage 2 (independent deep review):** high-score positive candidates are reviewed using their privately stored article body (up to 42,000 characters) and `@cf/openai/gpt-oss-120b`; an invalid structured output can fall back once to Llama 3.3 JSON Mode. Model-selected evidence anchor IDs resolve to literal source excerpts, eliminating fabricated quotation strings. The private D1 record stores verdict, rationale, risks, and verified source evidence. The local AI ledger caps automatic Stage 1 at 6 reviews/24h, reserves up to 2 Stage 2 attempts/24h, and limits all AI entries to 8/24h.\n- **Current limitation:** stage 2 has no fetched discussion-thread text, so it explicitly records `discussion_context=not_fetched`. Its verdict is a research aid, not final authorization to comment. Malformed output is rejected; no public write is performed.
- Each scheduled search must distinguish successful discovery, exhausted free-browser capacity, AI deferred by daily cap, and genuine upstream errors. Do not equate a zero-result page with success if the upstream request failed.
- Actions are read-only until an exact author-approved target and content are provided. Never publish based on automated discovery scores alone; protect against duplicates and ambiguous retries.
- Cloudflare free-browser budget and a D1 request pacing gate protect against paid overflow.

## Evidence

- 2026-10-24 cloud comment acceptance: [GitHub Actions #40048519286](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40048519286), published once and exact-account/body verified.
- **2026-10-24 [GitHub Actions #40074840891](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40074840891):** live cross-publication search returned 20 posts with 14 new posts (186 total stored), 2 full-article reads, and passed all 33 Node tests. An independent stage-one AI smoke check reviewed 1 article. Stage two's real invocation was **deferred by the daily AI limit**, and the complete search batch also deferred AI after saving both articles. Therefore this is a successful **search/read pipeline**, not proof of a live completed two-stage AI review.\n- Separate stage-two local/CI tests cover actual full stored article passing, a GPT-OSS invalid-output fallback to JSON-schema Llama 3.3, exact evidence-anchor constraints, and no writes on bad outputs. A live stage-two completed verdict remains to be accepted after the AI allowance resets.
- Browser access, AI evaluation, private state readback and public interaction are tested **separately**. One green check does not establish complete unattended operation.

Read `AGENTS.md` and `SOP.md` for privacy and execution controls.

## Scan-to-action lifecycle (2026-10-24)

Discovery is the source of new candidates, **not** the end of the workflow.

1. **Scan and deduplicate**: cross-publication post search stores stable post identities, scores and limited source evidence in private D1. Browser acquisitions share a free-tier quota.
2. **Decide**: stage-one screening classifies and stage-two checks an actual stored article (where quota permits). A `skip` decision is terminal. A high-scoring `like_review` is converted into a **private proposal** with exact body hash, origin `decision_pipeline_v1`, and state `proposed`. A `comment_review` becomes `needs_discussion_and_exact_comment`, not a public post; comment-thread context is not currently available to the AI.
3. **Approve**: the owner reads the private `GET /v1/write/action-outbox` using `OWNER_WRITE_KEY` and may create an exact proposal via `POST /v1/write/propose-decision` (comments require an exact body and explicit owner confirmation that discussion context was reviewed). Existing `/v1/write/approve-batch` pins each proposal ID and SHA-256 hash. No scheduled service can approve on the owner's behalf.
4. **Execute**: dedicated [GitHub approved-dispatch workflow](.github/workflows/approved-action-dispatch.yml) sends an empty timer signal every three hours to the Cloudflare Worker. It cannot choose the target or content and does not hold `OWNER_WRITE_KEY`. The Worker processes **at most one** proposal already approved in D1, under a single-use execution lock, daily limits, verified author/session and public post-write readback. Ambiguous results halt further writes instead of retrying blindly.
5. **Reconcile and retain**: progress is visible as aggregate `action_outbox` counts from the authenticated `/v1/status`, while immutable post IDs and interaction logs prevent duplicates. Article full text is compacted after 30 days only for completed or rejected decisions without pending proposals.

**Hard boundary:** no automatic public Like, Comment, or Note is authorized by a mere AI decision. The workflow is configured to execute only explicitly owner-approved actions. This avoids silently converting AI recommendations into public statements.

**Validation:** [GitHub Actions #40096832042](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40096832042) passed 43 JS tests and Worker deployment after introducing the action pipeline. [Approved-dispatch #40096912775](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40096912775) returned `no_approved_work` with HTTP 200, demonstrating that the timer cannot create unauthorized interactions. A real public action from this **new outbox path** still requires an owner-approved candidate and separate readback acceptance.

Cloudflare Free cron registration was rejected with code 10072 because the account had reached its five-trigger limit. The three-hour GitHub timer is the no-paid-upgrade fallback, **not** a GitHub holder of publication credentials.
