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
source_dir=ROOT/"src" if (ROOT/"src"/"substack_ops").is_dir() else LOCAL_ROOT/"src"
sys.path.insert(0,str(source_dir))
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
    cursor=None
    for _ in range(5):
        params={"types[]":"like","limit":50}
        if cursor:params["cursor"]=cursor
        p=c.http.get(f"https://substack.com/api/v1/reader/feed/profile/{c.cfg.user_id}",params=params)
        p.raise_for_status()
        data=p.json()
        if not isinstance(data.get("items"),list):
            raise RuntimeError("invalid_likes_feed")
        if any(int((x.get("post") or {}).get("id") or 0)==pid for x in data["items"]):
            return True
        cursor=data.get("nextCursor")
        if not cursor:return False
    raise RuntimeError("likes_feed_incomplete")

def has_exact_record(payload,record_id,body=None):
    if isinstance(payload,list):
        return any(has_exact_record(x,record_id,body) for x in payload)
    if not isinstance(payload,dict):
        return False
    if str(payload.get("id"))==str(record_id) and (body is None or payload.get("body")==body):
        return True
    return any(has_exact_record(x,record_id,body) for x in payload.values() if isinstance(x,(dict,list)))

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
        if not has_exact_record(comments,cid,body):raise RuntimeError("comment_readback_unverified")
        return str(cid)
    if kind=="note":
        if target!="https://johnnykao.substack.com/":raise ValueError("invalid_note_target")
        result=c.publish_note(body,dry_run=False)
        nid=result.get("id")
        if not nid:raise RuntimeError("note_result_without_id")
        published=c.list_notes(limit=40)
        if not has_exact_record(published,nid):raise RuntimeError("note_readback_unverified")
        return str(nid)
    raise ValueError("invalid_operation")

def main():
    key=KEY_FILE.read_text().strip()
    with httpx.Client(timeout=35,headers={"Authorization":"Bearer "+key}) as api:
        if "--check" in sys.argv:
            health=call(api,"/v1/runner/health")
            with SubstackClient.create() as c:
                profile=c.http.get("https://substack.com/api/v1/user/profile/self")
                profile.raise_for_status()
            print(json.dumps({"runner":health.get("runner") is True,"local_substack_authenticated":True}))
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
