import unittest
from scripts.qc import Candidate,precheck,comment_precheck
class Tests(unittest.TestCase):
    def test_filter(self):
        x=Candidate("p:123","A useful article title","2026-10-20T00:00:00Z",700)
        self.assertTrue(precheck(x,set())[0])
        self.assertEqual(precheck(x,{"p:123"})[1],"duplicate")
        self.assertFalse(comment_precheck("subscribe to https://example.com")[0])
