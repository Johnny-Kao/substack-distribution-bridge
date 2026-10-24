# Substack Distribution SOP — public operating contract

Private targeting weights, source lists, draft histories, engagement evidence, rejection reasons, and personalized QC judgments belong exclusively in private Cloudflare storage.

## Discovery
- Read approved source list / keywords from private policy through the authorized gateway.
- One scheduled Global Discovery workflow runs every three hours and searches Substack posts across publications, using a private D1 term/page cursor. Up to two full-article readbacks and bounded AI screening follow. RSS/source and publication-only schedules were retired on 2026-10-24; their utilities remain unscheduled for compatibility.
- GitHub timers are offset; Worker D1 provides an atomic 15-second Browser Run free-plan pacing gate. Maximum 44 general actions/24h (46 only for an exact approved-comment recovery), plus 390 seconds accounted time/24h, with no paid fallback.
- During initial integration testing, HTTP 403/429 is reported immediately as a failure rather than skipping subsequent scheduled or manual diagnostics. Only one 17-second retry for 429 browser pacing is allowed; persistent quota exhaustion is a visible failed/deferred run. Data stays private; GitHub logs show only aggregate counts.

## Content and quality
- Shortlist high-value articles based on substance, network relevance, recency and meaningful discussion. Keywords are an initial filter, not proof of quality.
- Store title, source, original URL, argument excerpt, scoring evidence, freshness, and proposed engagement type for each candidate in private D1. Candidate status does not grant posting permission.
- Explore multiple related query variants and result pages per subject, deduplicate publications across terms, then rank by recent relevant posts, discussion quality and meaningful engagement opportunity. Publication counts alone are not success, and M5 research is not cloud acceptance.
- Read the complete original article and existing discussion before proposing any comment.
- Prefer a concise English observation plus one thoughtful question, never empty praise or blatant link promotion.
- Notes: develop 5–6 genuinely distinct short hooks per long article. Keep pure-text hooks and original-article link hooks as separate experiments.
- Deterministic QC rejects invalid length, missing metadata, disallowed links, duplicates and violations of authorization. AI judges only residual semantic quality; independent review is preferable when needed.

## Execution and verification
- Batch approval authorizes only specific targets, exact content and specified operation types. Changing content/target voids that approval.
- Every operation has an immutable identifier, prior-state lookup, execution record and post-write readback verification.
- Never equate a successful HTTP response with verified publication.
- Do not retry an ambiguous network failure without checking whether Substack already completed the write.
- Scheduled read-only Discovery does not imply unattended public interactions.

## Learning and future automation
- Store candidate scores, approvals/rejections, reasons, engagement outcomes and QC revisions privately; never publish detailed behavior logs on GitHub.
- Periodically analyze which rule-based criteria reduced AI work without losing valuable candidates.
- Gradually expand autonomy only after user-approved policies, platform rules and quality evidence support it; begin with discovery and supervised batch operations.

## Independent acceptance
- Historical M5 local client verification does not constitute production acceptance; no local runner is deployed in the active cloud-only architecture.
- On 2026-10-23, Cloudflare owner-authenticated publication-search read-only request returned 17 valid new publications; D1 source pool contained 24 total and a feed from a newly discovered publication returned five parsed articles. The recurring GitHub subject workflow requires separate acceptance.
- Worker Browser Run public RSS returned HTTP 200 and XML; local orchestration fetched 10 articles, prequalified 1 and ingested 1 into D1 on 2026-10-23. GitHub-hosted Actions acceptance must be checked separately.
- Cloud authenticated session probe: HTTP 200 using the verified M5 header profile.
- Cloud private write staging: separate owner-only credential, no GitHub publication permissions; Dry-run and denial checks pass.
- Earlier direct Workers/GitHub requests to Substack were blocked by HTTP 429/403; Cloudflare Browser Sessions are the accepted authentication/readback transport. A specifically approved single Comment was published and independently verified in GitHub run #40048519286 on 2026-10-24. This is not general unattended write authorization.
- Public writes require explicit, exact target-and-body approval. Discovery never authorizes them; unsolicited auto-Likes, Comments and Notes remain disabled. Unknown write outcomes halt further action until independent readback.
- Acceptance must independently verify topic-wide discovery beyond fixed sources, semantic target review, prior-interaction deduplication, approved posting and post-write readback. RSS acquisition alone is not acceptance.
- Discovery must report an upstream block or zero fetched posts as degraded, never as success. No six-hour cooldown until the transport is verified; reintroduce a documented backoff policy only after successful end-to-end acceptance.
- Strict error mode: unexpected write-control failures halt operations; owner must explicitly resume.
- Approved engagement limits are enforced independently of the discovery schedule. One batch approval pins each target and exact body hash.

## Global Discovery semantic-screening regression (2026-10-24)
- An overnight scheduled Global Discovery run found 20 posts (18 new) and completed two full reads, then failed at Workers AI verdict validation. The post discovery portion was not at fault.
- The originally used Llama 3.1 8B non-fast model was deprecated on 2026-05-30; switching to it caused a live AI inference error. The fast variant's JSON mode behavior was inconsistent.
- The active JSON-schema capable `@cf/meta/llama-3.3-70b-instruct-fp8-fast` model, stricter response validation, and privacy-safe reason codes were deployed and accepted in live run #40055859970: one real queued article screened, HTTP 200.
- A successful single AI smoke review does not prove that future browser-budget constrained scheduled batches always execute. Continue to report upstream failures and quota deferrals explicitly; never replace a failed search with a zero-result success.

## Two-stage AI evaluation (added 2026-10-24)
- Stage 1: low-input-length Llama 3.3 JSON verdict based on at most 3,500 characters; no promise of full article comprehension.
- Stage 2: independent full-stored-article analysis of only high-scoring Stage 1 positive candidates; GPT-OSS 120B is tried first, with at most one Llama 3.3 JSON-mode fallback on an invalid structured result. Evidence is selected by deterministic numbered anchors sampled from the actual stored article; the model may only return a valid anchor ID.
- Both stages are read-only. Stage 2 stores its private result in D1 under engagement target evidence metadata; it does not supersede manual approval. Discussion-thread context is NOT yet fetched, must be labeled as such, and is required for any final discussion-sensitive publishing proposal.
- A failed deep model attempt counts against the shared daily AI usage ledger; deep attempts are capped at 2 per 24h and all AI entries at 8 per 24h. Quota deferral is not a completed deep assessment.
- Acceptance evidence: [Actions run #40074840891](https://github.com/Johnny-Kao/substack-distribution-bridge/actions/runs/40074840891) passed 33 Node tests, cloud deployment, stage-one real inference, actual global search (20 results, 14 new, 186 cumulative), and 2 full article reads. Deep inference was **deferred by daily AI cap**, and the end-to-end batch also deferred AI. Therefore live two-tier acceptance is still pending; do not equate green workflow status with two completed AI stages.
