"""GitHub-hosted, read-only, zero-token discovery.

Sources, personalized terms, and results come from / return to the private
Cloudflare gateway. NEVER print any response body, URL, term or individual
candidate to Actions logs. No artifacts. No local persistence.
"""
import json
import hashlib
import html
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

from scripts.qc import Candidate, precheck


def get_json(url, headers=None, payload=None, timeout=20):
    data = None if payload is None else json.dumps(payload).encode("utf8")
    request = Request(url, data=data, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123 Safari/537.36", "Accept": "application/json", **(headers or {})})
    with urlopen(request, timeout=timeout) as response:
        return json.load(response)


def get_rss(base, source, headers):
    # The Cloudflare Worker, not the GitHub runner, obtains the public RSS.
    request = Request(
        base + "/v1/source-feed",
        data=json.dumps({"source": source}).encode("utf8"),
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123 Safari/537.36",
            **headers, "Content-Type": "application/json", "Accept": "application/rss+xml",
        },
        method="POST",
    )
    with urlopen(request, timeout=55) as response:
        data = response.read(2_000_001)
    if len(data) > 2_000_000:
        raise ValueError("oversized_feed")
    return data


def parse_rss(content, source, limit=10):
    if b"<!DOCTYPE" in content.upper():
        raise ValueError("invalid_xml_doctype")
    root = ET.fromstring(content)
    if root.tag != "rss":
        raise ValueError("invalid_rss_root")
    out = []
    for item in root.findall("./channel/item")[:limit]:
        title = html.unescape(item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not link.startswith("https://" + source + ".substack.com/p/"):
            continue
        date = parsedate_to_datetime(item.findtext("pubDate") or "")
        if not date.tzinfo:
            continue
        content_html = item.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or item.findtext("description") or ""
        description = html.unescape(re.sub("<[^>]+>", " ", content_html))
        description = re.sub(r"\s+", " ", description).strip()
        out.append({
            "id": hashlib.sha256(link.encode("utf8")).hexdigest()[:20],
            "title": title,
            "subtitle": description[:400],
            "post_date": date.astimezone(timezone.utc).isoformat(),
            "wordcount": len(description.split()),
            "article_text": description[:12000],
            "canonical_url": link,
        })
    return out


def score_interaction_candidate(post, keywords):
    """Deterministic evidence, not a semantic endorsement or publish approval."""
    title = str(post.get("title") or "").casefold()
    text = str(post.get("article_text") or post.get("subtitle") or "").casefold()
    words = int(post.get("wordcount") or 0)
    title_hits = [k for k in keywords if k.casefold() in title]
    body_hits = [k for k in keywords if k.casefold() in text]
    try:
        age_days = max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(str(post["post_date"]).replace("Z", "+00:00"))).total_seconds() / 86400)
    except (ValueError, KeyError, TypeError):
        age_days = 3650
    score = min(45, 22 * len(title_hits)) + min(24, 8 * len(body_hits))
    score += 16 if age_days <= 3 else (10 if age_days <= 7 else (4 if age_days <= 30 else 0))
    score += 9 if 300 <= words <= 4000 else (4 if words >= 100 else 0)
    # The presence of a debatable claim is only a weak signal.
    argumentative = any(x in text for x in ("however", "because", "trade-off", "tradeoff", "should", "rather than", "the problem", "i argue", "in practice"))
    if argumentative:
        score += 6
    score = min(100, score)
    action = "comment_review" if score >= 57 and words >= 250 else "like_review"
    return {
        "score": score,
        "suggested_action": action,
        "signals": {
            "title_keyword_hits": len(title_hits),
            "body_keyword_hits": len(body_hits),
            "age_days": round(age_days, 1),
            "argument_signal": argumentative,
        },
        "excerpt": str(post.get("article_text") or post.get("subtitle") or "")[:3500],
        "word_count": words,
    }


def select(posts, source, keywords, seen):
    shortlisted = []
    for p in posts:
        if not isinstance(p, dict):
            continue
        pid = str(p.get("id") or "")
        title = str(p.get("title") or "")
        date = str(p.get("post_date") or "")
        key = f"{source}:{pid}"
        raw_words = p.get("wordcount") or 0
        try:
            words = int(raw_words)
        except (ValueError, TypeError):
            continue
        eligible, _ = precheck(Candidate(key, title, date, words), seen)
        if not eligible:
            continue
        searchable = (" " + title + " " + str(p.get("article_text") or p.get("subtitle") or "")).casefold()
        matches = sum(1 for kw in keywords if kw.casefold() in searchable)
        if matches < 1:
            continue
        url = p.get("canonical_url") or f"https://{source}.substack.com/p/{p.get('slug') or ''}"
        if not isinstance(url, str) or not url.startswith(("https://",)):
            continue
        shortlisted.append({
            "id": key,
            "pub": source,
            "title": title[:300],
            "url": url[:1000],
            "published": date[:80],
            **score_interaction_candidate(p, keywords),
        })
        seen.add(key)
    return shortlisted


def execute():
    base = os.environ["BRIDGE_URL"].rstrip("/")
    headers = {"Authorization": "Bearer " + os.environ["BRIDGE_KEY"]}
    plan = get_json(base + "/v1/plan", headers)
    keywords = [str(k) for k in plan.get("keywords", []) if isinstance(k, str) and 2 <= len(k) <= 60]
    sources = [str(s) for s in plan.get("sources", []) if isinstance(s, str) and s.replace("-", "").isalnum()]
    if not sources or not keywords:
        print("No private discovery configuration; no scan performed.")
        return 0
    # Deterministic hourly rotation; unlike random ordering, every configured
    # source gets a turn over successive scheduled hours.
    offset = int(datetime.now(timezone.utc).timestamp() // 3600) % len(sources)
    sources = sources[offset:] + sources[:offset]
    # No AI tokens are used for scanning.
    limit = max(1, min(int(plan.get("max_posts_per_source") or 10), 20))
    seen, candidates, limited, inspected, blocked = set(), [], False, 0, False
    jst_hour = datetime.now(ZoneInfo("Asia/Tokyo")).hour
    # Europe/US business windows: more coverage; Japan midday: lighter coverage.
    # Conservative Cloudflare Browser Run free-budget usage: one source per run,
    # two during EU/US activity windows, with a separate Worker daily budget.
    batch_sources = 2 if (jst_hour >= 17 or jst_hour < 6) else 1
    for source in sources[:batch_sources]:
        try:
            feed = get_rss(base, source, headers)
            payload = parse_rss(feed, source, limit)
            inspected += len(payload)
            candidates.extend(select(payload, source, keywords, seen))
        except HTTPError as error:
            if error.code in (403, 429):
                blocked = True
                limited = error.code == 429
                break
        except (URLError, TimeoutError, ValueError, ET.ParseError):
            pass
        time.sleep(random.uniform(0.5, 1.5))
    result = get_json(base + "/v1/ingest", {
        **headers, "Content-Type": "application/json",
    }, {"read_only": True, "candidates": candidates[:150], "rate_limited": limited, "upstream_blocked":blocked})
    if not result.get("ok"):
        raise RuntimeError("Private ingest returned unsuccessful status.")
    if blocked:
        print("Discovery blocked by upstream HTTP 403/429; no automatic cooldown.",file=sys.stderr)
        return 1
    if inspected == 0:
        print("Discovery degraded: no source returned inspectable posts.",file=sys.stderr)
        return 1
    print(f"Read-only scan completed; fetched {inspected}, prequalified {len(candidates)}, accepted {result.get('accepted',0)}, upstream_limited={limited}.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(execute())
    except Exception:
        # Avoid URL, private keyword, request headers, query payload or stack traces in public logs.
        print("Discovery failed (details intentionally suppressed from public Actions log).", file=sys.stderr)
        sys.exit(1)
