import csv
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import urasoe_district_population as district  # noqa: E402

BANDS = [
    "0-4歳", "5-9歳", "10-14歳", "15-19歳", "20-24歳", "25-29歳", "30-34歳",
    "35-39歳", "40-44歳", "45-49歳", "50-54歳", "55-59歳", "60-64歳",
    "65-69歳", "70-74歳", "75-79歳", "80-84歳", "85歳以上",
]
HEADER = [
    "市区町村コード", "地域コード", "都道府県名", "市区町村名", "調査年月日", "地域名",
    "総人口", "男性", "女性",
    *[f"{b}の{s}" for b in BANDS for s in ("男性", "女性")],
    "世帯数", "備考",
]

# 仲間: 男24・女23・計47、年少6・生産年齢30・高齢11
NAKAMA_BANDS = {
    "0-4歳": (1, 2),
    "10-14歳": (3, 0),
    "15-19歳": (10, 10),
    "60-64歳": (5, 5),
    "65-69歳": (4, 4),
    "85歳以上": (1, 2),
}
NAKAMA_RECORD = {
    "year_month": "202608", "district": "仲間", "total": 47, "male": 24, "female": 23,
    "households": 20, "child": 6, "working": 30, "elderly": 11,
}


def make_row(name, bands, households, total_override=None):
    """bands は {"0-4歳": (男性, 女性), ...}。指定のない階級は0人。"""
    male = sum(m for m, _ in bands.values())
    female = sum(f for _, f in bands.values())
    total = male + female if total_override is None else total_override
    cells = ["472085", "", "沖縄県", "浦添市", "令和8年8月31日", name, total, male, female]
    for b in BANDS:
        m, f = bands.get(b, (0, 0))
        cells += [m, f]
    cells += [households, ""]
    return cells


def make_csv(rows, header=HEADER):
    # 市の実ファイルと同じく、文字列はダブルクォートで囲み、数値は囲まない
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_NONNUMERIC, lineterminator="\r\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buf.getvalue()


class ParseOpendataCsvTest(unittest.TestCase):
    def test_sums_age_bands_into_three_generations(self):
        rows = [make_row("仲間", NAKAMA_BANDS, 20), make_row("全体", NAKAMA_BANDS, 20)]
        records, warnings = district.parse_opendata_csv(make_csv(rows), "202608")
        self.assertEqual(records, [NAKAMA_RECORD])
        self.assertEqual(warnings, [])

    def test_warns_when_city_total_row_is_missing(self):
        records, warnings = district.parse_opendata_csv(make_csv([make_row("仲間", NAKAMA_BANDS, 20)]), "202608")
        self.assertEqual(records, [NAKAMA_RECORD])
        self.assertTrue(any("全体" in w for w in warnings))

    def test_excludes_city_total_row(self):
        rows = [make_row("仲間", NAKAMA_BANDS, 20), make_row("全体", NAKAMA_BANDS, 20)]
        records, warnings = district.parse_opendata_csv(make_csv(rows), "202608")
        self.assertEqual([r["district"] for r in records], ["仲間"])
        self.assertEqual(warnings, [])

    def test_warns_when_city_total_row_disagrees_with_districts(self):
        rows = [make_row("仲間", NAKAMA_BANDS, 20), make_row("全体", NAKAMA_BANDS, 20, total_override=999)]
        records, warnings = district.parse_opendata_csv(make_csv(rows), "202608")
        self.assertEqual(len(records), 1)
        self.assertTrue(any("全体" in w for w in warnings))

    def test_reads_columns_by_name_when_first_column_is_renamed(self):
        header_2023 = ["都道府県コード又は市区町村コード", *HEADER[1:]]
        text = make_csv([make_row("仲間", NAKAMA_BANDS, 20)], header=header_2023)
        records, _ = district.parse_opendata_csv(text, "202608")
        self.assertEqual(records, [NAKAMA_RECORD])

    def test_missing_required_column_returns_nothing_with_warning(self):
        header = [h for h in HEADER if h != "世帯数"]
        records, warnings = district.parse_opendata_csv(make_csv([], header=header), "202608")
        self.assertEqual(records, [])
        self.assertTrue(any("世帯数" in w for w in warnings))

    def test_skips_row_with_non_numeric_cell_and_keeps_others(self):
        bad = make_row("牧港", NAKAMA_BANDS, 20)
        bad[6] = "x"  # 総人口
        rows = [make_row("仲間", NAKAMA_BANDS, 20), bad]
        records, warnings = district.parse_opendata_csv(make_csv(rows), "202608")
        self.assertEqual([r["district"] for r in records], ["仲間"])
        self.assertTrue(any("牧港" in w for w in warnings))

    def test_keeps_row_but_warns_when_generations_do_not_add_up_to_total(self):
        rows = [make_row("牧港", NAKAMA_BANDS, 20, total_override=50)]
        records, warnings = district.parse_opendata_csv(make_csv(rows), "202608")
        self.assertEqual(records[0]["total"], 50)
        self.assertTrue(any("牧港" in w for w in warnings))


class DecodeTest(unittest.TestCase):
    def test_decodes_cp932(self):
        self.assertEqual(district.decode_csv("仲間".encode("cp932")), "仲間")

    def test_returns_none_for_undecodable_bytes(self):
        self.assertIsNone(district.decode_csv(b"\x82"))

    def test_rejects_html_soft_404(self):
        self.assertFalse(district.looks_like_csv(b"  <!DOCTYPE html><html>"))
        self.assertTrue(district.looks_like_csv('"市区町村コード"'.encode("cp932")))


if __name__ == "__main__":
    unittest.main()
