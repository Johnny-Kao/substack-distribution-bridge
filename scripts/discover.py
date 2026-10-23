"""GitHub-hosted, read-only, zero-token discovery.

Sources, personalized terms, and results come from / return to the private
Cloudflare gateway. NEVER print any response body, URL, term or individual
candidate to Actions logs. No artifacts. No local persistence.
"""
import json
import os
import random
import sys
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from scripts.qc import Candidate, precheck


def get_json(url, headers=None, payload=None, timeout=20):
    data = None if payload is None else json.dumps(payload).encode("utf8")
    request = Request(url, data=data, headers=headers or {})
    with urlopen(request, timeout=timeout) as response:
        return json.load(response)


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
        searchable = (" " + title + " " + str(p.get("subtitle") or "")).casefold()
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
        })
        seen.add(key)
    return shortlisted


def execute():
    base = os.environ["BRIDGE_URL"].rstrip("/")
    headers = {"Authorization": "Bearer " + os.environ["BRIDGE_KEY"]}
    plan = get_json(base + "/v1/plan", headers)
    if int(plan.get("cooldown_until") or 0) > int(time.time() * 1000):
        print("Discovery skipped: upstream cooling period.")
        return 0
    keywords = [str(k) for k in plan.get("keywords", []) if isinstance(k, str) and 2 <= len(k) <= 60]
    sources = [str(s) for s in plan.get("sources", []) if isinstance(s, str) and s.replace("-", "").isalnum()]
    if not sources or not keywords:
        print("No private discovery configuration; no scan performed.")
        return 0
    random.shuffle(sources)
    # No AI cost for the scan. Limit sources and upstream requests per run.
    limit = max(1, min(int(plan.get("max_posts_per_source") or 10), 20))
    seen, candidates, limited, inspected = set(), [], False, 0
    jst_hour = datetime.now(ZoneInfo("Asia/Tokyo")).hour
    # Europe/US business windows: more coverage; Japan midday: lighter coverage.
    batch_sources = 5 if (jst_hour >= 17 or jst_hour < 6) else (3 if jst_hour < 12 else 2)
    for source in sources[:batch_sources]:
        url = f"https://{source}.substack.com/api/v1/posts?limit={limit}&offset=0"
        try:
            payload = get_json(url, {"Accept": "application/json", "User-Agent": "Mozilla/5.0"}, timeout=16)
            if isinstance(payload, list):
                inspected += len(payload)
                candidates.extend(select(payload, source, keywords, seen))
        except HTTPError as error:
            if error.code == 429:
                limited = True
                break
        except (URLError, TimeoutError, ValueError):
            pass
        time.sleep(random.uniform(0.5, 1.5))
    result = get_json(base + "/v1/ingest", {
        **headers, "Content-Type": "application/json",
    }, {"read_only": True, "candidates": candidates[:150], "rate_limited": limited})
    if not result.get("ok"):
        raise RuntimeError("Private ingest returned unsuccessful status.")
    print(f"Read-only scan completed; fetched {inspected}, prequalified {len(candidates)}, accepted {result.get('accepted',0)}, upstream_limited={limited}.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(execute())
    except Exception:
        # Avoid URL, private keyword, request headers, query payload or stack traces in public logs.
        print("Discovery failed (details intentionally suppressed from public Actions log).", file=sys.stderr)
        sys.exit(1)
