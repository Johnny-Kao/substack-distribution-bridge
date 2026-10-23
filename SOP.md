# Substack Distribution SOP — public operating contract

Private targeting weights, source lists, draft histories, engagement evidence, rejection reasons, and personalized QC judgments belong exclusively in private Cloudflare storage.

## Discovery
- Read approved source list / keywords from private policy through the authorized gateway.
- GitHub Actions performs zero-token metadata scanning and deterministic pre-QC: valid ID, publication date, article length, keyword fit, de-duplication, and upstream rate-limit handling.
- Scan hourly with bounded jitter; prioritize Europe/US windows, lighter scanning during Japan daytime.
- Rate-limits trigger a cooling window. Never retry repeatedly after 429. Data stays private; GitHub logs show only aggregate counts.

## Content and quality
- Shortlist high-value articles based on substance, network relevance, recency and meaningful discussion. Keywords are an initial filter, not proof of quality.
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
- M5 local client: five Likes, one Comment, and one Note were live-published and re-read 2026-10-22/23.
- GitHub Actions + Cloudflare D1: read-only Discovery end-to-end accepted 2026-10-23.
- Cloud writes and encrypted gateway require separate production acceptance. Do not mark them PASS based on local client tests.
