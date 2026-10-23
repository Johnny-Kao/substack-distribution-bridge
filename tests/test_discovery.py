import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from datetime import datetime, timezone
import os
from scripts.discover import select, execute, parse_rss, score_interaction_candidate

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
            raise AssertionError("unexpected URL")
        def blocked_rss(base, source, headers):
            raise HTTPError(base,403,"forbidden",{},None)
        with patch.dict(os.environ,{"BRIDGE_URL":"https://worker.example","BRIDGE_KEY":"dummy"}),patch("scripts.discover.get_json",side_effect=response),patch("scripts.discover.get_rss",side_effect=blocked_rss),patch("scripts.discover.time.sleep"):
            result=execute()
        self.assertEqual(result,1)
        self.assertEqual(len(reports),1)
        self.assertTrue(reports[0]["upstream_blocked"])
        self.assertEqual(reports[0]["candidates"],[])

    def test_browser_capacity_is_not_upstream_denial(self):
        from scripts.discover import BrowserCapacityError
        reports=[]
        def response(url,*args,**kwargs):
            if url.endswith("/v1/plan"):
                return {"sources":["samplepub"],"keywords":["family office"]}
            if url.endswith("/v1/ingest"):
                reports.append(args[1])
                return {"ok":True}
            raise AssertionError("unexpected URL")
        with patch.dict(os.environ,{"BRIDGE_URL":"https://worker.example","BRIDGE_KEY":"dummy"}),patch("scripts.discover.get_json",side_effect=response),patch("scripts.discover.get_rss",side_effect=BrowserCapacityError()),patch("scripts.discover.time.sleep"):
            result=execute()
        self.assertEqual(result,1)
        self.assertEqual(len(reports),1)
        self.assertTrue(reports[0]["browser_deferred"])
        self.assertFalse(reports[0]["upstream_blocked"])

    def test_public_rss_to_prequalified_post(self):
        body = " ".join(["family office governance decisions"] * 45)
        sample = (
            "<?xml version='1.0' encoding='UTF-8'?><rss version='2.0' "
            "xmlns:content='http://purl.org/rss/1.0/modules/content/'><channel><item>"
            "<title>Practical family office governance choices</title>"
            "<link>https://samplepub.substack.com/p/practical-governance</link>"
            "<pubDate>Tue, 20 Oct 2026 10:00:00 +0000</pubDate>"
            "<content:encoded><![CDATA[<p>"+body+"</p>]]></content:encoded>"
            "</item></channel></rss>"
        ).encode()
        posts = parse_rss(sample, "samplepub")
        self.assertEqual(len(posts), 1)
        self.assertGreater(posts[0]["wordcount"], 100)
        self.assertEqual(len(select(posts, "samplepub", ["family office"], set())), 1)

    def test_recommended_engagement_is_only_a_review_candidate(self):
        post = {
            "title": "Family office governance needs more explicit accountability",
            "article_text": ("Family office decision systems should have accountable stewards. "
                             "However, incentives diverge because delegation leaves unresolved questions. ") * 20,
            "wordcount": 350,
            "post_date": datetime.now(timezone.utc).isoformat(),
        }
        scored = score_interaction_candidate(post, ["family office", "governance"])
        self.assertEqual(scored["suggested_action"], "comment_review")
        self.assertGreaterEqual(scored["score"], 57)
        self.assertIn("because", scored["excerpt"])

if __name__=="__main__":
    unittest.main()
