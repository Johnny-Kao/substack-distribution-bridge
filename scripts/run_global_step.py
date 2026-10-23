"""Trigger one private global post-discovery page. No search terms or URLs in public logs."""
import os
import sys
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
    try:
        article=get_json(base+"/v1/global/read",headers,payload={},timeout=55)
        if article.get("ok") is not True:
            print("Full article verification failed.",file=sys.stderr)
            return 1
        print("Full article readback="+str(int(article.get("full_read",0)))+".")
        screened=get_json(base+"/v1/global/screen",headers,payload={},timeout=55)
        if screened.get("ok") is not True:
            print("Private semantic screening rejected the result.",file=sys.stderr)
            return 1
        print("Private semantic screening completed; reviewed="+str(int(screened.get("reviewed",0)))+".")
    except (HTTPError,URLError,TimeoutError,ValueError):
        print("Private semantic screening deferred or unavailable.",file=sys.stderr)
        return 1
    return 0

if __name__=="__main__":
    try:
        sys.exit(execute())
    except Exception:
        print("Global content discovery failed; private details suppressed.",file=sys.stderr)
        sys.exit(1)
