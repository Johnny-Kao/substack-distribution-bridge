"""Single-pass M5 Substack runner. Claim approved jobs only; fail closed on uncertainty."""
import hashlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
import httpx

ROOT=Path(__file__).resolve().parents[1]
BASE="https://substack-distribution-bridge.at12885.workers.dev"
KEY_FILE=ROOT/".cache/runner_key"
LOCAL_ROOT=ROOT.parent
sys.path.insert(0,str(LOCAL_ROOT/"src"))
from substack_ops.client import SubstackClient

def call(client,path,body=None):
    r=client.post(BASE+path,json=body) if body is not None else client.get(BASE+path)
    r.raise_for_status()
    return r.json()

def post_id_for(c,url):
    p=urlparse(url)
    if p.scheme!="https" or not p.hostname or not p.hostname.endswith(".substack.com"):
        raise ValueError("invalid post host")
    parts=p.path.strip("/").split("/")
    if len(parts)!=2 or parts[0]!="p":
        raise ValueError("invalid post path")
    response=c.http.get(f"https://{p.hostname}/api/v1/posts/{parts[1]}")
    response.raise_for_status()
    return int(response.json()["id"]),f"https://{p.hostname}"

def known_like(c,pid):
    p=c.http.get(f"https://substack.com/api/v1/reader/feed/profile/{c.cfg.user_id}",params={"types[]":"like","limit":50})
    p.raise_for_status()
    data=p.json()
    return any(int(x.get("post",{}).get("id") or 0)==pid for x in data.get("items",[]))

def verified_job(c,job):
    kind,target,body=job["kind"],job["target"],job["body"]
    fingerprint=hashlib.sha256((kind+"\0"+target+"\0"+body).encode()).hexdigest()
    if fingerprint!=job["hash"]:raise ValueError("approval_hash_mismatch")
    if kind=="like":
        pid,pub=post_id_for(c,target)
        if known_like(c,pid):return str(pid)
        c.react_to_post(pid,pub=pub,dry_run=False)
        if not known_like(c,pid):raise RuntimeError("like_readback_unverified")
        return str(pid)
    if kind=="comment":
        pid,pub=post_id_for(c,target)
        result=c.add_comment(post_id=pid,body=body,pub=pub,dry_run=False)
        cid=result.get("id")
        if not cid:raise RuntimeError("comment_result_without_id")
        comments=c.get_comments(post_id=pid,pub=pub)
        if str(cid) not in json.dumps(comments):raise RuntimeError("comment_readback_unverified")
        return str(cid)
    if kind=="note":
        if target!="https://johnnykao.substack.com/":raise ValueError("invalid_note_target")
        result=c.publish_note(body,dry_run=False)
        nid=result.get("id")
        if not nid:raise RuntimeError("note_result_without_id")
        published=c.list_notes(limit=40)
        if str(nid) not in json.dumps(published):raise RuntimeError("note_readback_unverified")
        return str(nid)
    raise ValueError("invalid_operation")

def main():
    key=KEY_FILE.read_text().strip()
    with httpx.Client(timeout=35,headers={"Authorization":"Bearer "+key}) as api:
        if "--check" in sys.argv:
            print(json.dumps(call(api,"/v1/runner/health")))
            return
        msg=call(api,"/v1/runner/next",{})
        job=msg.get("job")
        if not job:
            print(json.dumps({"claimed":False,"halted":msg.get("halted",False)}))
            return
        try:
            with SubstackClient.create() as c:
                public_id=verified_job(c,job)
        except Exception:
            call(api,"/v1/runner/complete",{"id":job["id"],"outcome":"unknown"})
            raise
        print(json.dumps(call(api,"/v1/runner/complete",{"id":job["id"],"outcome":"verified","public_id":public_id})))

if __name__=="__main__":main()
