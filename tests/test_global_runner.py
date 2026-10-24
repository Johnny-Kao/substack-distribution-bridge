"""Cloud-only global runner tests; no real credentials or Substack requests."""
import os
import unittest
from unittest.mock import patch
from scripts import run_global_step

class CloudGlobalRunnerTests(unittest.TestCase):
    def test_two_article_reads_and_two_screenings(self):
        calls = []
        def fake(url, headers, payload, timeout):
            suffix = url.split("/v1/")[-1]
            calls.append(suffix)
            if suffix == "global/step":
                return {"ok": True, "returned":20,"new_posts":18,"prequalified":4,"stored_total":136}
            if suffix == "global/read":
                return {"ok": True,"full_read":1}
            if suffix == "global/screen":
                return {"ok": True,"reviewed":1}
            if suffix == "global/deep-review":
                return {"ok": True,"reviewed":1,"stage":"deep_review","publication_performed":False}
            self.fail("Unexpected private endpoint")
        with patch.dict(os.environ, {"BRIDGE_URL":"https://bridge.example","BRIDGE_KEY":"not-a-real-secret"}), patch.object(run_global_step, "get_json", side_effect=fake), patch.object(run_global_step.time, "sleep") as sleep:
            self.assertEqual(run_global_step.execute(), 0)
        self.assertEqual(calls, ["global/step","global/read","global/read","global/screen","global/screen","global/deep-review"])
        self.assertEqual(sleep.call_count, 2)
        sleep.assert_any_call(17)

    def test_empty_queue_does_not_call_ai(self):
        calls=[]
        def fake(url, headers, payload, timeout):
            endpoint=url.split("/v1/")[-1]
            calls.append(endpoint)
            return {"ok":True,**({"full_read":0} if endpoint=="global/read" else {"reason":"no_qualified_candidate","reviewed":0} if endpoint=="global/deep-review" else {})}
        with patch.dict(os.environ, {"BRIDGE_URL":"https://bridge.example","BRIDGE_KEY":"fake"}), patch.object(run_global_step, "get_json", side_effect=fake), patch.object(run_global_step.time, "sleep"):
            self.assertEqual(run_global_step.execute(),0)
        self.assertEqual(calls,["global/step","global/read","global/deep-review"])

if __name__=="__main__":
    unittest.main()
