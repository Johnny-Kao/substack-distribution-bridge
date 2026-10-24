"""Trigger one private global post-discovery page. No search terms or URLs in public logs."""
import os
import sys
import time
from urllib.error import HTTPError, URLError
from scripts.discover import get_json

def execute():
    base=os.environ["BRIDGE_URL"].rstrip("/")
    headers={"Authorization":"Bearer "+os.environ["BRIDGE_KEY"],"Content-Type":"application/json"}
    try:
        result=get_json(base+"/v1/global/step",headers,payload={},timeout=55)
    except HTTPError as error:
        if error.code==429:
            # Could be the 15-second shared browser pacing gate. Only one
            # delayed retry is permitted; rolling quota exhaustion stays FAIL.
            print("Global browser pacing or free quota; one bounded 17s retry.",file=sys.stderr)
            time.sleep(17)
            try:
                result=get_json(base+"/v1/global/step",headers,payload={},timeout=55)
            except HTTPError as retry:
                print("Global content discovery deferred; HTTP "+str(retry.code),file=sys.stderr)
                return 1
            except (URLError,TimeoutError,ValueError):
                print("Global content retry unavailable.",file=sys.stderr)
                return 1
        else:
            print("Global content discovery unavailable; status "+str(error.code),file=sys.stderr)
            return 1
    except (URLError,TimeoutError,ValueError):
        print("Global content discovery transport or response error.",file=sys.stderr)
        return 1
    if result.get("ok") is not True:
        print("Global content discovery unsuccessful.",file=sys.stderr)
        return 1
    print("Global post discovery: results="+str(int(result.get("returned",0)))+
          ", new="+str(int(result.get("new_posts",0)))+
          ", review candidates="+str(int(result.get("prequalified",0)))+
          ", total stored="+str(int(result.get("stored_total",0)))+".")
    # Read two articles per run when budget allows. Cloudflare Browser Run
    # calls share a 15-second D1 pacing gate; each read is spaced explicitly.
    # A quota deferral stops the batch without losing the completed search.
    full_reads = 0
    for _ in range(2):
        time.sleep(17)
        try:
            article = get_json(base+"/v1/global/read", headers, payload={}, timeout=55)
        except HTTPError as error:
            if error.code == 429:
                print("Full article read deferred by shared browser quota.", file=sys.stderr)
                break
            print("Full article read failed; HTTP status "+str(error.code), file=sys.stderr)
            return 1
        except (URLError, TimeoutError, ValueError):
            print("Full article read transport error.", file=sys.stderr)
            return 1
        if article.get("ok") is not True:
            print("Full article verification failed.", file=sys.stderr)
            return 1
        count = int(article.get("full_read", 0))
        full_reads += count
        if not count:
            break
    print("Full article readbacks="+str(full_reads)+".")
    # AI uses the existing shared 8-per-day quota. Run only for articles
    # whose complete original text was successfully retrieved.
    reviewed = 0
    for _ in range(full_reads):
        try:
            screened = get_json(base+"/v1/global/screen", headers, payload={}, timeout=55)
        except (HTTPError, URLError, TimeoutError, ValueError):
            print("Private semantic screening unavailable.", file=sys.stderr)
            return 1
        if screened.get("ok") is not True:
            # Only log a fixed allowlisted error category. Never expose the
            # original article, subject, author, prompt or model response.
            reason = screened.get("reason")
            safe = reason if reason in ("invalid_ai_verdict", "invalid_ai_json", "ai_inference_failed", "invalid_ai_result") else "unknown_screening_failure"
            print("Private semantic screening failed; category="+safe+".", file=sys.stderr)
            return 1
        count = int(screened.get("reviewed", 0))
        reviewed += count
        if not count:
            break
    print("Private semantic screening completed; reviewed="+str(reviewed)+".")
    # Second-stage deep assessment is independent and read-only; it draws
    # private stored article text, not the 3500-character stage-one excerpt.
    try:
        deep = get_json(base+"/v1/global/deep-review", headers, payload={}, timeout=100)
    except (HTTPError, URLError, TimeoutError, ValueError):
        print("Deep semantic review unavailable; no public action attempted.",file=sys.stderr)
        return 1
    if deep.get("ok") is not True:
        reason=deep.get("reason")
        safe=reason if reason in ("deep_ai_inference_failed","invalid_deep_verdict") else "unknown_deep_failure"
        print("Deep semantic review failed; category="+safe+".",file=sys.stderr)
        return 1
    deep_count=int(deep.get("reviewed",0))
    if deep_count:
        print("Deep semantic review completed; reviewed="+str(deep_count)+".")
    else:
        why=deep.get("reason")
        safe=why if why in ("no_qualified_candidate","ai_daily_cap","ai_not_configured") else "unknown"
        print("Deep semantic review deferred; category="+safe+".")
    return 0

if __name__=="__main__":
    try:
        sys.exit(execute())
    except Exception:
        print("Global content discovery failed; private details suppressed.",file=sys.stderr)
        sys.exit(1)
