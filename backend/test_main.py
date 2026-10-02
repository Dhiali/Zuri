import os
import unittest


class GroqConfigTests(unittest.TestCase):
    def test_import_without_groq_key_does_not_crash(self):
        os.environ.pop("GROQ_API_KEY", None)
        import backend.main
        self.assertTrue(hasattr(backend.main, "app"))


if __name__ == "__main__":
    unittest.main()
