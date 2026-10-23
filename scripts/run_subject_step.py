"""Private GitHub-to-Worker subject discovery trigger. No personalized values in logs."""
import os
import sys
from urllib.error import HTTPError, URLError

from scripts.discover import get_json


def execute():
    base=os.environ["BRIDGE_URL"].rstrip("/")
    headers={"Authorization":"Bearer "+os.environ["BRIDGE_KEY"],"Content-Type":"application/json"}
    try:
        result=get_json(base+"/v1/subject/step",headers,payload={},timeout=55)
    except HTTPError as error:
        # Do not print server response or URL: those can contain private data.
        print("Subject discovery failed; upstream status class "+str(error.code),file=sys.stderr)
        return 1
    except (URLError,TimeoutError,ValueError):
        print("Subject discovery failed; network or response error.",file=sys.stderr)
        return 1
    if not result.get("ok"):
        print("Subject discovery unsuccessful.",file=sys.stderr)
        return 1
    print("Subject publication discovery succeeded; examined "+
          str(int(result.get("returned",0)))+" search results, valid "+
          str(int(result.get("valid",0)))+", total distinct publications "+
          str(int(result.get("stored_total",0)))+".")
    return 0


if __name__=="__main__":
    try:
        sys.exit(execute())
    except Exception:
        print("Subject discovery failed (private details suppressed).",file=sys.stderr)
        sys.exit(1)
