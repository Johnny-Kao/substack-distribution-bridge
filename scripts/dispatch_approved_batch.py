"""Cloud-only processing of up to 20 already owner-approved Substack Likes.

The GitHub runner supplies only a numbered clock signal, never target names,
post bodies or write credentials. Cloudflare D1 owns all authorization.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

MAX_STEPS = 20
PACING_SECONDS = 17
SUCCESS_STATES = {
    "verified_executed", "already_executed", "declined_permission",
    "claimed_elsewhere", "already_triggered_this_slot",
}
DEFER_STATES = {
    "no_approved_work", "paused", "daily_interaction_cap",
    "deferred_browser_quota",
}

def dispatch(base, key, *, transport=None, sleep=time.sleep):
    if not base.startswith("https://") or not key:
        raise ValueError("bridge credentials unavailable")
    if transport is None:
        transport = submit
    states = {}
    for step in range(MAX_STEPS):
        if step:
            sleep(PACING_SECONDS)  # D1 additionally enforces shared 15s spacing.
        result = transport(base, key, step)
        status = result.get("status")
        if result.get("ok") is not True or status not in SUCCESS_STATES | DEFER_STATES:
            raise RuntimeError("unexpected_or_ambiguous_cloud_dispatch_response")
        states[status] = states.get(status, 0) + 1
        if status in DEFER_STATES:
            break  # Defer without retry; hourly schedule resumes remaining work.
    return states

def submit(base, key, step):
    req = urllib.request.Request(
        base.rstrip("/") + "/v1/global/dispatch-approved",
        method="POST", data=json.dumps({"step": step}).encode(),
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "User-Agent": "approved-actions-hourly/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=115) as resp:
        if resp.status != 200:
            raise RuntimeError("cloud_dispatch_http_error")
        return json.load(resp)

def main():
    try:
        counts = dispatch(os.environ["BRIDGE_URL"], os.environ["BRIDGE_KEY"])
        # Counts only: no plaintext private post metadata in GitHub logs.
        print("Approved batch: verified=" + str(counts.get("verified_executed", 0))
              + ", already=" + str(counts.get("already_executed", 0))
              + ", declined=" + str(counts.get("declined_permission", 0))
              + ", duplicate_slot=" + str(counts.get("already_triggered_this_slot", 0))
              + ", deferred=" + str(sum(counts.get(s, 0) for s in DEFER_STATES))
              + ", upper_limit=" + str(MAX_STEPS))
        return 0
    except (KeyError, ValueError, OSError, urllib.error.URLError, RuntimeError) as exc:
        # Never log response bodies or authentication keys.
        print("Approved batch: FAIL, check private Cloudflare logs; "
              + type(exc).__name__, file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
