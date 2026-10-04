import datetime
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import requests  # noqa: E402

import urasoe_common as common  # noqa: E402


class FakeResponse:
    def __init__(self, status_code, content=b""):
        self.status_code = status_code
        self.content = content


class CandidateUrlsTest(unittest.TestCase):
    def test_one_url_per_base_in_order(self):
        urls = common.candidate_urls("202608", "opendata.csv")
        self.assertEqual(len(urls), len(common.BASE_URLS))
        self.assertEqual(urls[0], common.BASE_URLS[0] + "/202608opendata.csv")


class FetchFirstTest(unittest.TestCase):
    def test_skips_404_and_invalid_content(self):
        responses = [
            FakeResponse(404),
            FakeResponse(200, b"<html>soft 404</html>"),
            FakeResponse(200, b"good"),
        ]
        with mock.patch.object(common.requests, "get", side_effect=responses) as get:
            content, url = common.fetch_first("202608", "opendata.csv", lambda c: not c.startswith(b"<"))
        self.assertEqual(content, b"good")
        self.assertEqual(url, common.BASE_URLS[2] + "/202608opendata.csv")
        self.assertEqual(get.call_count, 3)

    def test_returns_none_when_every_request_fails(self):
        with mock.patch.object(common.requests, "get", side_effect=requests.ConnectionError("down")) as get:
            result = common.fetch_first("202608", "opendata.csv", lambda c: True)
        self.assertEqual(result, (None, None))
        self.assertEqual(get.call_count, len(common.BASE_URLS))


class MonthsTest(unittest.TestCase):
    def test_month_iter_crosses_year_boundary(self):
        self.assertEqual(
            list(common.month_iter("2023-11", "2024-02")),
            ["202311", "202312", "202401", "202402"],
        )

    def test_recent_months_oldest_first(self):
        self.assertEqual(
            common.recent_months(3, today=datetime.date(2026, 1, 15)),
            ["202511", "202512", "202601"],
        )


class CsvStoreTest(unittest.TestCase):
    def test_header_written_once_and_months_read_back(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "sub" / "out.csv"
            self.assertEqual(common.load_existing_year_months(path), set())
            common.append_records(path, ["year_month", "x"], [{"year_month": "202601", "x": 1}])
            common.append_records(path, ["year_month", "x"], [{"year_month": "202602", "x": 2}])
            lines = path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(lines, ["year_month,x", "202601,1", "202602,2"])
            self.assertEqual(common.load_existing_year_months(path), {"202601", "202602"})


if __name__ == "__main__":
    unittest.main()
