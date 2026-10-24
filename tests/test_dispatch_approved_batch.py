import unittest
from scripts.dispatch_approved_batch import dispatch, MAX_STEPS, PACING_SECONDS

class ApprovedBatchTest(unittest.TestCase):
    def test_full_twenty_step_hourly_batch(self):
        steps=[]
        sleeps=[]
        def fake(base,key,step):
            steps.append(step)
            return {"ok":True,"status":"verified_executed"}
        counts=dispatch("https://bridge.example","private-key",transport=fake,sleep=sleeps.append)
        self.assertEqual(steps,list(range(20)))
        self.assertEqual(counts["verified_executed"],20)
        self.assertEqual(sleeps,[PACING_SECONDS]*19)
        self.assertEqual(MAX_STEPS,20)

    def test_empty_approved_queue_stops_immediately(self):
        steps=[]
        def fake(base,key,step):
            steps.append(step)
            return {"ok":True,"status":"no_approved_work"}
        counts=dispatch("https://bridge.example","private-key",transport=fake,sleep=lambda _:None)
        self.assertEqual(steps,[0])
        self.assertEqual(counts["no_approved_work"],1)

    def test_existing_slot_can_advance_without_retry(self):
        calls=[]
        def fake(base,key,step):
            calls.append(step)
            return {"ok":True,"status":"already_triggered_this_slot" if step==0 else "no_approved_work"}
        dispatch("https://bridge.example","private-key",transport=fake,sleep=lambda _:None)
        self.assertEqual(calls,[0,1])

    def test_browser_quota_defers_without_retry(self):
        steps=[]
        def fake(base,key,step):
            steps.append(step)
            return {"ok":True,"status":"deferred_browser_quota"}
        dispatch("https://bridge.example","private-key",transport=fake,sleep=lambda _:None)
        self.assertEqual(steps,[0])

    def test_ambiguous_write_fails_closed_without_retry(self):
        steps=[]
        def fake(base,key,step):
            steps.append(step)
            return {"ok":False,"status":"ambiguous_write_halted"}
        with self.assertRaises(RuntimeError):
            dispatch("https://bridge.example","private-key",transport=fake,sleep=lambda _:None)
        self.assertEqual(steps,[0])

    def test_no_plaintext_or_missing_key_from_caller(self):
        with self.assertRaises(ValueError):
            dispatch("http://unsafe.local","secret",transport=lambda *x:None,sleep=lambda _:None)
        with self.assertRaises(ValueError):
            dispatch("https://bridge.example","",transport=lambda *x:None,sleep=lambda _:None)

if __name__=="__main__":
    unittest.main()
