import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location(
    "sanitize_traces", Path(__file__).with_name("sanitize-traces.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TraceSafetyTests(unittest.TestCase):
    def test_drops_credentials_but_retains_action_timing_and_screenshots(self):
        secret = "secret-session-ticket-cookie"
        image = "a" * 40 + ".jpeg"
        frame = "screencast/page@abc123-123456789.jpeg"
        events = [
            {"type": "context-options", "version": 8, "browserName": "chromium",
             "options": {"storageState": secret}},
            {"type": "before", "callId": "call@1", "startTime": 1,
             "apiName": "page.evaluate", "params": {"expression": secret}},
            {"type": "after", "callId": "call@1", "endTime": 2,
             "result": secret, "error": {"message": secret}},
            {"type": "console", "text": secret},
            {"type": "frame-snapshot", "snapshot": secret},
            {"type": "screencast-frame", "sha1": image, "timestamp": 2},
            {"type": "screencast-frame", "file": frame, "timestamp": 3},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            source, dest = Path(tmp) / "raw.zip", Path(tmp) / "clean.zip"
            with zipfile.ZipFile(source, "w") as raw:
                raw.writestr("trace.trace", "\n".join(map(json.dumps, events)))
                raw.writestr("trace.network", secret)
                raw.writestr("trace.stacks", secret)
                raw.writestr("resources/body", secret)
                raw.writestr(f"resources/{image}", b"\xff\xd8\xffimage")
                raw.writestr(frame, b"\xff\xd8\xffimage")
            module.sanitize(source, dest)
            with zipfile.ZipFile(dest) as clean:
                self.assertEqual(set(clean.namelist()), {"trace.trace", f"resources/{image}", frame})
                for name in clean.namelist():
                    self.assertNotIn(secret.encode(), clean.read(name))
                safe = list(map(json.loads, clean.read("trace.trace").splitlines()))
                self.assertEqual(safe[1]["callId"], "call@1")
                self.assertEqual(safe[1]["params"], {})
                self.assertEqual(safe[2]["endTime"], 2)

    def test_invalid_trace_leaves_no_upload(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, dest = Path(tmp) / "raw.zip", Path(tmp) / "clean.zip"
            with zipfile.ZipFile(source, "w") as raw:
                raw.writestr("trace.trace", "broken JSON")
            with self.assertRaises(ValueError):
                module.sanitize(source, dest)
            self.assertFalse(dest.exists())


if __name__ == "__main__":
    unittest.main()
