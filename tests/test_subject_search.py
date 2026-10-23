import unittest

from scripts.subject_search import search_publications


class SubjectSearchTests(unittest.TestCase):
    def test_paginate_and_deduplicate_queries(self):
        calls = []
        def fetch(path, params):
            calls.append((path, params.copy()))
            key = params["query"]
            page = params["page"]
            if key == "topic one":
                if page == 0:
                    return {"results": [{"id": 1, "subdomain": "example-a", "name": "A"},
                                        {"id": 2, "subdomain": "example-b", "name": "B"}], "more": True}
                return {"results": [{"id": 3, "subdomain": "example-c", "name": "C"}], "more": False}
            return {"results": [{"id": 2, "subdomain": "example-b", "name": "B"},
                                {"id": 4, "subdomain": "example-d", "name": "D"}], "more": False}

        result = search_publications(fetch, ["topic one", "topic two"], max_pages_per_subject=4)
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(result.publications), 4)
        self.assertEqual(result.queries, 2)
        self.assertFalse(result.more_available)
        self.assertEqual(next(x for x in result.publications if x["id"] == 2)["matched_terms"], ["topic one", "topic two"])

    def test_request_budget_is_hard(self):
        result = search_publications(lambda path, params: {
            "results": [{"id": params["page"] + 1, "subdomain": "abc", "name": "A"}],
            "more": True,
        }, ["topic one", "topic two"], max_pages_per_subject=6, request_budget=2)
        self.assertEqual(result.requests, 2)
        self.assertTrue(result.more_available)

    def test_bad_result_fails_explicitly(self):
        with self.assertRaisesRegex(ValueError, "unexpected_publication"):
            search_publications(lambda path, params: {"results": None}, ["topic one"])


if __name__ == "__main__":
    unittest.main()
