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
            print("Private semantic screening rejected the result.", file=sys.stderr)
            return 1
        count = int(screened.get("reviewed", 0))
        reviewed += count
        if not count:
            break
    print("Private semantic screening completed; reviewed="+str(reviewed)+".")
    return 0

if __name__=="__main__":
    try:
        sys.exit(execute())
    except Exception:
        print("Global content discovery failed; private details suppressed.",file=sys.stderr)
        sys.exit(1)
