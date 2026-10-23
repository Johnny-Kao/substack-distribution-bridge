import unittest
from scripts.discover import select

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

if __name__=="__main__":
    unittest.main()
