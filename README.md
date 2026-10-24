# Substack Distribution Bridge

Cloud-only Substack discovery and supervised engagement using GitHub Actions, Cloudflare Workers, Browser Rendering, Workers AI and private D1. No personal Mac/M5 is required to run the deployed system.

## Active production architecture

- **One scheduled discovery pipeline:** `.github/workflows/global-discovery.yml`, every three hours. It searches Substack posts **across publications**, maintains private D1 cursors, deduplicates post IDs, selects candidate posts, targets up to **10 full articles per scheduled batch** (bounded by Cloudflare's free Browser Run quota and 15-second pacing gate) and runs bounded semantic assessment.
- Cloudflare D1 stores targets, drafts, scores, outcomes, identity checks, and authorization state. GitHub logs must not expose private subjects, targets, session credentials, or unpublished drafts.
- A separately approved, single exact-comment operation has been published from Cloudflare and independently verified against the author account and post. That **does not authorize unattended commenting or posting on other articles**.
- The authenticated Like state can be read via the cloud-only Browser Session path. Posting, idempotency, and readback are separate capabilities; do not assume all write operations work from a successful read.

## Retired legacy schedules

As of 2026-10-24, the independent RSS/source-feed schedule (`discovery.yml`) and publication-only subject discovery schedule (`subject-discovery.yml`) have been deleted. They were redundant for the user's platform-wide post-search objective and competed for Browser Rendering quota.

Lower-level RSS/feed parsers and older subject-search functions remain in the repository as uninvoked utilities for compatibility and tests; **they are not production scheduled jobs**.

## Review and verification

- **Stage 1 (lightweight):** Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` evaluates up to 3,500 characters per article using a strict JSON verdict (comment / like / skip). It is a short-input first pass, **not** a full-article evaluation.
- **Stage 2 (independent deep review):** high-score positive candidates are reviewed using their privately stored article body (up to 42,000 characters) and `@cf/openai/gpt-oss-120b`; an invalid structured output can fall back once to Llama 3.3 JSON Mode. Model-selected evidence anchor IDs resolve to literal source excerpts, eliminating fabricated quotation strings. The private D1 record stores verdict, rationale, risks, and verified source evidence. The local AI ledger caps automatic Stage 1 at **5 reviews/24h**, Stage 2 at **2 attempts/24h**, and context-aware English comment drafting at **1 attempt/24h**, sharing 8 AI entries per rolling 24h. A 10-article read batch does not imply ten AI inferences.
- **Stage separation:** the independent deep-review inference is article-only and records `discussion_context=not_fetched`. A separate downstream authenticated step now retrieves a bounded discussion sample before drafting. Neither stage automatically authorizes or publishes a comment.
- Each scheduled search must distinguish successful discovery, exhausted free-browser capacity, AI deferred by daily cap, and genuine upstream errors. Do not equate a zero-result page with success if the upstream request failed.
- Actions are read-only until an exact author-approved target and content are provided. Never publish based on automated discovery scores alone; protect against duplicates and ambiguous retries.
- Cloudflare free-browser budget and a D1 request pacing gate protect against paid overflow.

## Evidence

- 2026-10-24 cloud comment acceptance: [GitHub Actions #40048519286](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40048519286), published once and exact-account/body verified.
- **2026-10-24 [GitHub Actions #40074840891](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40074840891):** live cross-publication search returned 20 posts with 14 new posts (186 total stored), 2 full-article reads, and passed all 33 Node tests. An independent stage-one AI smoke check reviewed 1 article. Stage two's real invocation was **deferred by the daily AI limit**, and the complete search batch also deferred AI after saving both articles. Therefore this is a successful **search/read pipeline**, not proof of a live completed two-stage AI review.
- Separate stage-two local/CI tests cover actual full stored article passing, a GPT-OSS invalid-output fallback to JSON-schema Llama 3.3, exact evidence-anchor constraints, and no writes on bad outputs. A live stage-two completed verdict remains to be accepted after the AI allowance resets.
- Browser access, AI evaluation, private state readback and public interaction are tested **separately**. One green check does not establish complete unattended operation.

Read `AGENTS.md` and `SOP.md` for privacy and execution controls.

## Scan-to-action lifecycle (2026-10-24)

Discovery is the source of new candidates, **not** the end of the workflow.

1. **Scan and deduplicate**: cross-publication post search stores stable post identities, scores and limited source evidence in private D1. Browser acquisitions share a free-tier quota.
2. **Decide**: stage-one screening classifies and stage-two checks an actual stored article (where quota permits). A `skip` decision is terminal. A high-scoring `like_review` is converted into a **private proposal** with exact body hash, origin `decision_pipeline_v1`, and state `proposed`. A `comment_review` now enters authenticated, read-only discussion retrieval (up to 20 sampled comments) and then a context-aware English comment-draft step. The owner reviews or rewrites the exact text before creating/approving a proposal; thread context is explicitly labeled as a bounded sample, not necessarily all comments.
3. **Approve**: the owner reads the private `GET /v1/write/action-outbox` using `OWNER_WRITE_KEY` and may create an exact proposal via `POST /v1/write/propose-decision` (comments require a verified D1 discussion snapshot, an exact body and explicit owner confirmation that discussion context was reviewed). Existing `/v1/write/approve-batch` pins each proposal ID and SHA-256 hash. No scheduled service can approve on the owner's behalf.
4. **Execute**: dedicated [GitHub approved-dispatch workflow](.github/workflows/approved-action-dispatch.yml) sends a numbered timer signal hourly to the Cloudflare Worker. It cannot choose the target or content and does not hold `OWNER_WRITE_KEY`. The Worker processes **up to 20** individually approved Like proposals in one hourly batch (one verified write per numbered request, with at least 17 seconds between requests), under a single-use execution lock, daily limits, verified author/session and public post-write readback. Ambiguous results halt further writes instead of retrying blindly.
5. **Reconcile and retain**: progress is visible as aggregate `action_outbox` counts from the authenticated `/v1/status`, while immutable post IDs and interaction logs prevent duplicates. Unresolved discovery candidates expire after 45 days if they have no pending/uncertain action, so the review queue cannot grow forever. Large original article text is compacted after 30 days for completed, skipped or expired decisions without pending proposals; stable post IDs and audit records remain for deduplication.

**Hard boundary:** no automatic public Like, Comment, or Note is authorized by a mere AI decision. The workflow is configured to execute only explicitly owner-approved actions. This avoids silently converting AI recommendations into public statements.

**Validation:** [GitHub Actions #40096832042](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40096832042) passed 43 JS tests and Worker deployment after introducing the action pipeline. [Approved-dispatch #40096912775](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40096912775) returned `no_approved_work` with HTTP 200, demonstrating that the timer cannot create unauthorized interactions. A real public action from this **new outbox path** still requires an owner-approved candidate and separate readback acceptance.

Cloudflare Free cron registration was rejected with code 10072 because the account had reached its five-trigger limit. The three-hour GitHub timer is the no-paid-upgrade fallback, **not** a GitHub holder of publication credentials.

## Private feedback and learning (new)

The model does **not** retrain itself automatically. Instead, the system stores actual owner choices and outcome evidence in private D1 `interaction_feedback` and summarizes recent examples as *in-context preferences* in future screening and drafting prompts. It distinguishes owner **Like / Comment / Skip** choices, reasons, approved exact texts, rejections, and verified execution results; model suggestions alone are **not** counted as owner preferences. A manual override between Like and Comment is allowed on a qualified deep-reviewed candidate, subject to thread-context and exact-approval safeguards.

**Owner API integration (private `OWNER_WRITE_KEY`, not the GitHub scheduling key):**

- `GET /v1/write/action-outbox`: see reviewed articles, discussion read status and a draft awaiting review.
- `POST /v1/write/feedback` with JSON `{"id":"publication:postID","choice":"like|comment|skip","reason":"optional rationale","event_id":"stable-unique-click-id","edited_body":"optional approved revision"}`: records the owner's decision with idempotency when `event_id` is reused. This does not publish anything.
- `POST /v1/write/propose-decision` with `{"id":"publication:postID","kind":"comment","body":"EXACT REVIEWED COMMENT","discussion_reviewed":true}` or `{"id":"publication:postID","kind":"like","body":""}`: privately stages the precise proposal. Comments require a verified stored discussion sample, not just a client flag.
- `POST /v1/write/approve-batch` with proposal ID and hash: marks the exact content approved and **atomically records approval as feedback** for known articles. The existing cloud dispatcher only executes previously approved proposals, with readback verification.
- `POST /v1/write/reject-decision` with `{"proposal_id":"decision_xxx","reason":"..."}`: rejects an unexecuted staged proposal and records a negative editorial signal.
- `GET /v1/write/learning-summary`: aggregate private feedback counts. No private article titles, comments or choices are printed to public GitHub Actions.

The private D1 table is created via the Worker D1 binding's fixed idempotent `/v1/global/setup-feedback` route, invoked after deploy. The existing GitHub Cloudflare token does not need D1 import permissions, nor does GitHub receive `OWNER_WRITE_KEY`. Previously made selections that were never recorded cannot be inferred reliably and are **not** fabricated or retrospectively classified as training data.

**Evidence and limitations:** [Cloud build #40101817761](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40101817761) passed 50 JavaScript tests and 11 Python tests, deployed the Worker, and verified the private D1 feedback table. It does not by itself prove a live batch can retrieve ten full articles or that every comment thread can be accessed; those depend on private candidate availability, Cloudflare Browser Run free quota and Substack permissions. No public posting was initiated by this change.

## Exact owner-approved Like batches (2026-10-25)

Chat-approved engagement is an authorization decision **only for explicitly named posts**, not a blanket policy permitting the AI to Like arbitrary discoveries. The previous gap between that approval and the private D1 execution queue is bridged with one-time, authenticated encrypted delivery:

- The original owner approval lists exactly ten Substack posts. A private JSON payload including verified numeric post IDs and canonical URLs was encrypted with RSA-OAEP/AES-GCM using the existing public encryption key. Only the encrypted envelope is retained in the PUBLIC GitHub repo, at `private_envelopes/approved_fo_wm_pb_likes_2026-10-25.enc.json`. Plaintext post identities and owner selections are never committed to GitHub.
- The Worker `POST /v1/global/import-approved-like-batch` requires the existing bridge transport credential, decrypts using the private key stored **only in Cloudflare Secrets**, and verifies the single pinned SHA-256 digest of this exact previously approved batch. A transport key alone cannot authorize arbitrary future actions or change the recipient list. Bad or modified payloads fail closed.
- Cloudflare D1 atomically adds the confirmed explicit owner selections to private `interaction_feedback`, registers external post IDs, and creates or upgrades exact-hash `decision_pipeline_v1` Like proposals to `approved`. Repeat imports are idempotent; already-executed or uncertain writes are not resubmitted.
- The new encrypted-only GitHub import workflow invokes one authorized Cloudflare dispatcher tick after successful D1 enrollment. The existing approved-outbox dispatcher runs hourly via free GitHub scheduling. Its Python driver processes **up to 20** exact-owner-approved Like proposals per hourly batch, spaced at least 17 seconds apart (D1 independently enforces a 15-second Browser Run pacing gate). The verified Like cap is 20 per rolling 24 hours, and the shared Browser Run duration/action caps remain unchanged. A lack of approved work or an exhausted quota stops the batch without retrying or upgrading the account. It never promotes a proposed action and verifies a live Substack readback before marking success.
- The current one-time import is intentionally **not** a generic permission for future AI decisions. Each new batch still requires explicit owner choice and a uniquely constrained encrypted approval envelope. No `OWNER_WRITE_KEY` needs to be shared in chat, and no local Mac runner is part of recurring cloud execution.
- Cloud acceptance: [encrypted batch #40114394862](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40114394862) returned `accepted=10`, `pending_approved_total=10` and verified the first public Like. A separate authenticated outbox readback reported nine approved pending, one executed and zero uncertain. This is verified execution, not merely a dry run.

## Hourly approved Like batching (2026-10-25)

GitHub Actions `.github/workflows/approved-action-dispatch.yml` now runs `python3 -m scripts.dispatch_approved_batch`, providing **up to 20** distinct, idempotently locked Cloudflare dispatch signals per hourly run. Each signal selects only an already approved D1 target; steps 1–19 are Like-only, while the first step retains support for individually approved comments. Cloudflare also caps verified Like attempts to **20 per rolling 24 hours** independently of the GitHub schedule. One action receives its own post-write verification. The controller waits 17 seconds between calls to respect the shared 15-second Browser Run gate, and terminates on an empty queue or exhausted quota. Network ambiguity is a failure and blocks retries. If a batch cannot complete within the free Browser Run budget, later hourly runs resume the pending D1 queue. 20 is a limit, not a guaranteed completion count.

Code validation: [#40116063090](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40116063090), 57 JS and 18 Python tests passing, Worker deployed. The prior one-per-hour dispatch constraint is obsolete.

## Interrupted approved-Like batch recovery (2026-10-25)

The first live 20-slot driver [#40116106668](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40116106668) failed after about 171 seconds with an HTTP error. D1 aggregates show **7 verified Likes, 2 still approved, 1 ambiguous**, not zero successful operations. The old GitHub driver discarded the HTTP code and step. A separate Substack read-only authenticated probe [#40117485123](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40117485123) observed that the interrupted article is **currently not liked**, but this does not prove no POST ever happened.

The orphaned operation was marked unknown and the D1 write policy halted, with no automatic retry or reset. Two already-approved actions remain queued but blocked until explicit resolution. The Worker now checks all executing/unknown operations before starting any new public action, and the driver stops on this state. The read-only reconciliation route does not Like or Comment; it only confirms current state and can close an orphan if the Like is already verified present. Failed dispatch diagnostics now log only step, HTTP code and a safe error category.

Evidence: [private aggregate audit #40117761992](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40117761992) (7 completed / 2 approved / 1 unknown); [deployment #40117724171](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40117724171) (62 JS and 20 Python tests passing); [follow-up clock #40117653061](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40117653061) correctly reported paused, with zero further Likes. The 20-action batch limit remains in code but is not a guarantee that all posts succeed or quotas permit execution.
