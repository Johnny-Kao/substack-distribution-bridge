import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import os
from scripts.discover import select
from scripts.discover import execute

class DiscoveryTests(unittest.TestCase):
    def test_keyword_prefilter_and_dedup(self):
        posts = [
            {"id": 42, "title": "A practical family office investment governance question", "post_date": "2026-10-20T10:00:00Z", "wordcount": 550, "canonical_url": "https://example.org/article"},
            {"id": 43, "title": "Unrelated holiday note", "post_date": "2026-10-20T10:00:00Z", "wordcount": 550, "canonical_url": "https://example.org/holiday"},
            {"id": 44, "title": "Family office daily brief", "post_date": "2026-10-20T10:00:00Z", "wordcount": 20, "canonical_url": "https://example.org/brief"},
        ]
        matched=select(posts,"samplepub",["family office"],set())
        self.assertEqual(len(matched),1)
        self.assertEqual(matched[0]["id"],"samplepub:42")

    def test_upstream_403_is_not_successful_empty_scan(self):
        reports=[]
        def response(url,*args,**kwargs):
            if url.endswith("/v1/plan"):
                return {"sources":["samplepub"],"keywords":["family office"],"max_posts_per_source":10,"cooldown_until":9999999999999}
            if url.endswith("/v1/ingest"):
                reports.append(args[1])
                return {"ok":True,"accepted":0}
            raise HTTPError(url,403,"forbidden",{},None)
        with patch.dict(os.environ,{"BRIDGE_URL":"https://worker.example","BRIDGE_KEY":"dummy"}),patch("scripts.discover.get_json",side_effect=response),patch("scripts.discover.time.sleep"):
            result=execute()
        self.assertEqual(result,1)
        self.assertEqual(len(reports),1)
        self.assertTrue(reports[0]["upstream_blocked"])
        self.assertEqual(reports[0]["candidates"],[])

if __name__=="__main__":
    unittest.main()
