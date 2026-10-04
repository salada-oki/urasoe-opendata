# 地区別人口ランキング Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 浦添市が公開する行政区別(42地区)の人口CSVを月次で取り込み、既存ダッシュボードに「地区別人口ランキング」(総人口/高齢化率の横棒グラフ)を追加する。

**Architecture:** Python側は、既存スクリプトと新スクリプトで共通の「候補URLを順に試す取得処理・年月の列挙・CSV追記」を `scripts/urasoe_common.py` に切り出し、新スクリプト `scripts/urasoe_district_population.py` が市のShift-JIS CSVを読み、42地区×年月の整形済みUTF-8 CSV `data/district_population.csv` に書き出す。フロントエンドはそのCSVを `docs/lib.js` の純関数でパース・順位付けし、`docs/app.js` がChart.jsの横棒グラフとして描画する。地区別データの読み込み失敗は地区別セクションだけに閉じ込め、市全体のセクションには影響させない。

**Tech Stack:** Python 3.11(標準ライブラリ`unittest`・`csv`、既存依存の`requests`)、Vanilla JS(ESモジュール)、Chart.js 4.4.4(既存CDN)、Node組み込みテストランナー、GitHub Actions、GitHub Pages(`docs/`配信)

**Spec:** `docs/superpowers/specs/2026-10-02-district-population-design.md`

## Global Constraints

- ビルドツール・フレームワークは使わない。Chart.jsは既存の `index.html` のCDNタグ(`chart.js@4.4.4`)をそのまま使う
- Python・JSとも新しい依存パッケージを追加しない(Pythonのテストは標準ライブラリ`unittest`で書く)
- 市のファイル: `{base}/{YYYYMM}opendata.csv`、文字コードは`cp932`、**2023年1月分以降のみ存在**
- 市のCSVの`地域名`が`全体`の行は市全体の合計行なので、取り込み時に除外する
- 市のCSVの列は**名前で**読む(1列目の名前は年によって違う)
- 年齢3区分: 年少 = `0-4歳`・`5-9歳`・`10-14歳`、生産年齢 = `15-19歳`〜`60-64歳`の10階級、高齢 = `65-69歳`・`70-74歳`・`75-79歳`・`80-84歳`・`85歳以上`。それぞれ`{階級}の男性`と`{階級}の女性`の合計
- 出力CSVの列(この順): `year_month, district, total, male, female, households, child, working, elderly`
- 画面の文言(そのまま使う):
  - 読み込み失敗: `地区別データを読み込めませんでした。`
  - 地区別データより前の年月: `地区別データは{最初の月}以降のみ利用可能です。`(例: `地区別データは2023年1月以降のみ利用可能です。`)
  - 地区別データより後の年月: `{年月}の地区別データはまだありません。`(例: `2023年2月の地区別データはまだありません。`)
- 画面の書き換えは `textContent` / `append` / `replaceChildren` だけで行い、`innerHTML` は使わない
- 地区別データの読み込み・描画の失敗で、市全体のセクション(カード・円グラフ・ピラミッド・推移・傾向レポート)を止めない

## 計画時に確定した、仕様書への補足

- 地区数は42(仕様書の初版は41と誤記。仕様書は修正済み)
- フロントエンドが読むのは市の生CSVではなく、Pythonが書き出したUTF-8の`district_population.csv`。ダブルクォート付きの値への対応は、念のため残す
- 「〜以降のみ利用可能です」の年月は、地区別データの最初の月から作る(実データでは2023年1月になる)
- 市全体のPDFは公開済みで地区別CSVはまだ、という月がありうるので、`まだありません`の文言を追加した
- ワークフローの `git add data/ docs/data/` はディレクトリごと追加しているので、新しいCSVのための変更は不要

## Review Focus

テストのない入力・状況のうち、使う人が困りやすいもの(多い順)。それぞれ、担当タスクにテストを追加済み。

1. **市のCSVの`全体`行** — 残っていると、ランキングの1位が常に「全体」になる。除外されること(Task 2)
2. **市全体データはあるが地区別データがない年月を選んだとき** — 2023年1月より前でも、最新月が地区別だけ未公開でも、グラフが空のまま無言にならず、理由を表示すること(Task 4)
3. **地区別CSVが読めないとき**(初回のActions実行前、通信エラー) — 市全体のカードやグラフは通常どおり表示され、地区別セクションにだけ`地区別データを読み込めませんでした。`が出ること(Task 4)
4. **年による列名の違い** — 1列目の名前が違う古い月のファイルでも取り込めること(Task 2)
5. **人口がごく少ない地区**(キャンプキンザー59人など) — 高齢化率で並べると極端な値で上位に来るので、ツールチップに地区の総人口も出し、誤読を防ぐこと(Task 4)

---

### Task 1: 取得処理の共通モジュール `scripts/urasoe_common.py`

既存`urasoe_population.py`の候補URL一覧・取得処理・年月の列挙・CSV読み書きを共通モジュールに移す。既存スクリプトの動作は変えない。

**Files:**
- Create: `scripts/urasoe_common.py`
- Modify: `scripts/urasoe_population.py`(18〜58行目のimport・定数・`fetch_pdf_bytes`、123〜151行目の`month_iter`・`load_existing_year_months`・`append_records`、154〜198行目の呼び出し側)
- Test: `tests/test_urasoe_common.py`

**Interfaces:**
- Produces(Task 2が使う):
  - `BASE_URLS: list[str]` — 末尾に`/`なしのベースURL(例: `https://cms.city.urasoe.lg.jp/doc/2024061900039/file_contents`)
  - `DATA_DIR: pathlib.Path` — リポジトリの`data/`
  - `candidate_urls(ym: str, filename_suffix: str) -> list[str]` — `f"{base}/{ym}{filename_suffix}"`を`BASE_URLS`の順に返す
  - `fetch_first(ym: str, filename_suffix: str, is_valid: Callable[[bytes], bool]) -> tuple[bytes, str] | tuple[None, None]`
  - `month_iter(start_ym: str, end_ym: str) -> Iterator[str]` — 引数は`"YYYY-MM"`、返すのは`"YYYYMM"`
  - `recent_months(lookback: int, today: datetime.date | None = None) -> list[str]` — 古い順の`"YYYYMM"`
  - `load_existing_year_months(csv_path: Path) -> set[str]`
  - `append_records(csv_path: Path, fieldnames: list[str], records: list[dict]) -> None`

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_urasoe_common.py` を作成:

```python
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
```

- [ ] **Step 2: テストを実行し、失敗することを確認する**

Run: `python -m unittest discover -s tests -p "test_*.py" -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'urasoe_common'`

- [ ] **Step 3: 共通モジュールを実装する**

`scripts/urasoe_common.py` を作成:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""浦添市の人口ファイル取得スクリプトの共通処理。

urasoe_population.py(年齢別・市全体のPDF)と
urasoe_district_population.py(行政区別のCSV)の両方から使う。
"""

import csv
import datetime
from pathlib import Path

import requests

# 市のサイトは年ごとにファイルの置き場所のページが分かれ、年が終わると
# アーカイブページに移る。新しい年のページができたら、ここに1行足せば
# 両方のスクリプトが対応する。
BASE_URLS = [
    "https://cms.city.urasoe.lg.jp/doc/2024061900039/file_contents",
    "https://www.city.urasoe.lg.jp/doc/2026081000058/file_contents",  # 令和7年(2025)
    "https://www.city.urasoe.lg.jp/doc/2026081000041/file_contents",  # 令和6年(2024)
    "https://www.city.urasoe.lg.jp/doc/6656c72c699259328fa9f750/file_contents",  # 令和5年(2023)
    "https://www.city.urasoe.lg.jp/doc/6656ca9e699259328fa9f8bc/file_contents",  # 令和4年(2022)
    "https://www.city.urasoe.lg.jp/doc/6656ccbe699259328fa9f972/file_contents",  # 令和3年(2021)
]

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; urasoe-opendata-bot/1.0)"}


def candidate_urls(ym, filename_suffix):
    return [f"{base}/{ym}{filename_suffix}" for base in BASE_URLS]


def fetch_first(ym, filename_suffix, is_valid):
    """候補URLを順に試し、is_valid(content) を満たす最初の (content, url) を返す。

    見つからなければ (None, None)。
    """
    for url in candidate_urls(ym, filename_suffix):
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
        except requests.RequestException:
            continue
        if r.status_code == 200 and is_valid(r.content):
            return r.content, url
    return None, None


def month_iter(start_ym, end_ym):
    """'YYYY-MM' から 'YYYY-MM' までの各月を 'YYYYMM' で返す。"""
    y, m = int(start_ym[:4]), int(start_ym[5:7])
    ey, em = int(end_ym[:4]), int(end_ym[5:7])
    while (y, m) <= (ey, em):
        yield f"{y}{m:02d}"
        m += 1
        if m > 12:
            m = 1
            y += 1


def recent_months(lookback, today=None):
    """今月を含む直近 lookback ヶ月を、古い順の 'YYYYMM' で返す。"""
    today = today or datetime.date.today()
    y, m = today.year, today.month
    months = []
    for _ in range(lookback):
        months.append(f"{y}{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    months.reverse()
    return months


def load_existing_year_months(csv_path):
    if not csv_path.exists():
        return set()
    with csv_path.open(newline="", encoding="utf-8") as f:
        return {row["year_month"] for row in csv.DictReader(f)}


def append_records(csv_path, fieldnames, records):
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    file_exists = csv_path.exists()
    with csv_path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerows(records)
```

改行コードは既存ファイルと同じ `\r\n`(`DictWriter`の既定)のままにする。`lineterminator` は指定しない(既存の `data/population_by_age.csv` は `\r\n` で書かれていることを確認済み)。

- [ ] **Step 4: テストを実行し、成功することを確認する**

Run: `python -m unittest discover -s tests -p "test_*.py" -v`
Expected: 6件すべて PASS

- [ ] **Step 5: 既存スクリプトを共通モジュールに切り替える**

`scripts/urasoe_population.py` を次のように変更する。

18〜58行目(import から `fetch_pdf_bytes` の終わりまで)を、次で置き換える:

```python
import argparse
import io
import re
import sys
import time

import pdfplumber

from urasoe_common import (
    DATA_DIR,
    append_records,
    fetch_first,
    load_existing_year_months,
    month_iter,
    recent_months,
)

CSV_PATH = DATA_DIR / "population_by_age.csv"
FIELDNAMES = ["year_month", "age", "male", "female", "total", "source_url"]

NUM_RE = re.compile(r"^[\d,]+$")


def fetch_pdf_bytes(ym: str):
    """指定年月(YYYYMM)のPDFを候補URLから探して取得する。見つからなければ (None, None)。"""
    return fetch_first(ym, "nenrei-zentai.pdf", lambda content: content[:4] == b"%PDF")
```

123〜151行目の `month_iter`・`load_existing_year_months`・`append_records` の定義を削除する(共通モジュールから import 済み)。

`process_months` の中の呼び出しを、次の2か所だけ変える:

```python
    existing = load_existing_year_months(CSV_PATH) if skip_existing else set()
```

```python
        append_records(CSV_PATH, FIELDNAMES, records)
```

`cmd_latest` を次で置き換える:

```python
def cmd_latest(args):
    process_months(recent_months(args.lookback), skip_existing=not args.force)
```

- [ ] **Step 6: 既存スクリプトが動くことを確認する**

Run: `python scripts/urasoe_population.py backfill --start 2026-08 --end 2026-08`
Expected: `[skip] 202608 は取得済み` と `合計 0 行を追加しました。`(取得済みの月なので通信もファイル書き込みも起きない)

Run: `git status --porcelain data/`
Expected: 出力なし(データファイルが変わっていない)

Run: `python -m unittest discover -s tests -p "test_*.py" -v`
Expected: 6件すべて PASS

- [ ] **Step 7: コミット**

```bash
git add scripts/urasoe_common.py scripts/urasoe_population.py tests/test_urasoe_common.py
git commit -m "refactor: share URL list and fetch helpers in urasoe_common"
```

---

### Task 2: 地区別データ取得スクリプト `scripts/urasoe_district_population.py`

**Files:**
- Create: `scripts/urasoe_district_population.py`
- Create(実行結果として生成): `data/district_population.csv`、`docs/data/district_population.csv`
- Test: `tests/test_district_population.py`

**Interfaces:**
- Consumes(Task 1): `DATA_DIR`, `append_records`, `fetch_first`, `load_existing_year_months`, `month_iter`, `recent_months`
- Produces(Task 3・4が読むファイル): `data/district_population.csv` と同内容の `docs/data/district_population.csv`。UTF-8、ヘッダー `year_month,district,total,male,female,households,child,working,elderly`、1行 = 1年月×1地区、`全体`行なし
- Produces(このタスクのテストが使う):
  - `decode_csv(content: bytes) -> str | None` — cp932でデコード、失敗なら `None`
  - `looks_like_csv(content: bytes) -> bool` — 先頭(空白除く)が`<`ならHTMLとみなして `False`
  - `parse_opendata_csv(text: str, ym: str) -> tuple[list[dict], list[str]]` — (レコード, 警告メッセージ)

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_district_population.py` を作成:

```python
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
        records, warnings = district.parse_opendata_csv(make_csv([make_row("仲間", NAKAMA_BANDS, 20)]), "202608")
        self.assertEqual(records, [NAKAMA_RECORD])
        self.assertEqual(warnings, [])

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
```

- [ ] **Step 2: テストを実行し、失敗することを確認する**

Run: `python -m unittest discover -s tests -p "test_*.py" -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'urasoe_district_population'`(Task 1の6件はPASSのまま)

- [ ] **Step 3: スクリプトを実装する**

`scripts/urasoe_district_population.py` を作成:

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
浦添市「地域・年齢別人口」オープンデータCSV(行政区別)を取得し、
data/district_population.csv に地区別・年月別で蓄積する。

使い方:
    # 過去分をまとめて取得(このCSVは2023年1月分以降のみ公開されている)
    python scripts/urasoe_district_population.py backfill --start 2023-01 --end 2026-09

    # 直近数ヶ月だけチェック(GitHub Actionsの定期実行用)
    python scripts/urasoe_district_population.py latest --lookback 3

出力: data/district_population.csv
  列: year_month, district, total, male, female, households, child, working, elderly
"""

import argparse
import csv
import io
import sys
import time

from urasoe_common import (
    DATA_DIR,
    append_records,
    fetch_first,
    load_existing_year_months,
    month_iter,
    recent_months,
)

FILENAME_SUFFIX = "opendata.csv"
CSV_PATH = DATA_DIR / "district_population.csv"
FIELDNAMES = ["year_month", "district", "total", "male", "female", "households", "child", "working", "elderly"]

CHILD_BANDS = ["0-4歳", "5-9歳", "10-14歳"]
WORKING_BANDS = [
    "15-19歳", "20-24歳", "25-29歳", "30-34歳", "35-39歳",
    "40-44歳", "45-49歳", "50-54歳", "55-59歳", "60-64歳",
]
ELDERLY_BANDS = ["65-69歳", "70-74歳", "75-79歳", "80-84歳", "85歳以上"]

# 42地区の行のあとにある、市全体の合計行の地域名
TOTAL_ROW_NAME = "全体"


def band_columns(bands):
    return [f"{band}の{sex}" for band in bands for sex in ("男性", "女性")]


NUMERIC_COLUMNS = ["総人口", "男性", "女性", "世帯数", *band_columns(CHILD_BANDS + WORKING_BANDS + ELDERLY_BANDS)]
REQUIRED_COLUMNS = ["地域名", *NUMERIC_COLUMNS]


def decode_csv(content):
    try:
        return content.decode("cp932")
    except UnicodeDecodeError:
        return None


def looks_like_csv(content):
    return content.lstrip()[:1] != b"<"


def parse_opendata_csv(text, ym):
    """市のCSV本文を地区ごとのレコードにする。戻り値は (records, warnings)。"""
    reader = csv.DictReader(io.StringIO(text))
    missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
    if missing:
        return [], [f"必要な列がありません: {missing}"]

    records, warnings = [], []
    city_total = None
    for row in reader:
        name = (row["地域名"] or "").strip()
        try:
            values = {c: int(row[c]) for c in NUMERIC_COLUMNS}
        except (TypeError, ValueError):
            warnings.append(f"数値でない値があるため行をスキップしました: {name or '(地域名なし)'}")
            continue
        if not name:
            warnings.append("地域名が空の行をスキップしました")
            continue
        if name == TOTAL_ROW_NAME:
            city_total = values["総人口"]
            continue

        child = sum(values[c] for c in band_columns(CHILD_BANDS))
        working = sum(values[c] for c in band_columns(WORKING_BANDS))
        elderly = sum(values[c] for c in band_columns(ELDERLY_BANDS))
        if child + working + elderly != values["総人口"]:
            warnings.append(
                f"{name}: 年齢3区分の合計({child + working + elderly})が総人口({values['総人口']})と一致しません"
            )
        records.append(
            {
                "year_month": ym,
                "district": name,
                "total": values["総人口"],
                "male": values["男性"],
                "female": values["女性"],
                "households": values["世帯数"],
                "child": child,
                "working": working,
                "elderly": elderly,
            }
        )

    district_sum = sum(r["total"] for r in records)
    if city_total is not None and city_total != district_sum:
        warnings.append(f"地区の合計({district_sum})が「{TOTAL_ROW_NAME}」行({city_total})と一致しません")
    return records, warnings


def process_months(year_months, skip_existing=True, sleep_sec=1.0):
    existing = load_existing_year_months(CSV_PATH) if skip_existing else set()
    total_added = 0
    for ym in year_months:
        if ym in existing:
            print(f"[skip] {ym} は取得済み")
            continue
        content, url = fetch_first(ym, FILENAME_SUFFIX, looks_like_csv)
        if content is None:
            print(f"[none] {ym} の地区別CSVは見つかりませんでした(未公開、または2023年1月より前)")
            continue
        text = decode_csv(content)
        if text is None:
            print(f"[warn] {ym} はCSVを取得できたが文字コード(cp932)で読めませんでした: {url}")
            continue
        records, warnings = parse_opendata_csv(text, ym)
        for w in warnings:
            print(f"[warn] {ym} {w}")
        if not records:
            print(f"[warn] {ym} はCSVを取得できたが地区の行がありませんでした: {url}")
            continue
        append_records(CSV_PATH, FIELDNAMES, records)
        total_added += len(records)
        print(f"[ok]   {ym} : {len(records)}地区 追加 ({url})")
        time.sleep(sleep_sec)  # サーバーへの負荷配慮
    print(f"合計 {total_added} 行を追加しました。")


def cmd_backfill(args):
    process_months(list(month_iter(args.start, args.end)), skip_existing=not args.force)


def cmd_latest(args):
    process_months(recent_months(args.lookback), skip_existing=not args.force)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_backfill = sub.add_parser("backfill", help="指定期間をまとめて取得")
    p_backfill.add_argument("--start", required=True, help="開始年月 YYYY-MM")
    p_backfill.add_argument("--end", required=True, help="終了年月 YYYY-MM")
    p_backfill.add_argument("--force", action="store_true", help="既存行があっても再取得する")
    p_backfill.set_defaults(func=cmd_backfill)

    p_latest = sub.add_parser("latest", help="直近nヶ月だけチェック(定期実行用)")
    p_latest.add_argument("--lookback", type=int, default=3, help="何ヶ月さかのぼって確認するか")
    p_latest.add_argument("--force", action="store_true", help="既存行があっても再取得する")
    p_latest.set_defaults(func=cmd_latest)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: テストを実行し、成功することを確認する**

Run: `python -m unittest discover -s tests -p "test_*.py" -v`
Expected: 16件すべて PASS(Task 1の6件 + このタスクの10件)

- [ ] **Step 5: 実データを取得する(初回バックフィル、通信あり)**

Run: `python scripts/urasoe_district_population.py backfill --start 2023-01 --end 2026-09`
Expected:
- 2023年1月〜2026年8月の各月が `[ok]   YYYYMM : 42地区 追加`
- 2026年9月は、市が公開済みなら `[ok]`、未公開なら `[none]`
- `[warn]` が出た場合は、その内容を作業報告に書く(どの月の、どの地区か)。`[warn]`があってもこのステップは止めない

- [ ] **Step 6: 取得したデータを検証する**

Run:

```bash
python -c "
import csv
from collections import Counter
rows = list(csv.DictReader(open('data/district_population.csv', encoding='utf-8')))
per_month = Counter(r['year_month'] for r in rows)
print('months', len(per_month), min(per_month), max(per_month))
print('districts per month', sorted(set(per_month.values())))
print('全体 rows', sum(1 for r in rows if r['district'] == '全体'))
bad = [r for r in rows if int(r['child']) + int(r['working']) + int(r['elderly']) != int(r['total'])]
print('generation mismatches', len(bad))
"
```

Expected: `months 44 202301 202608`(2026年9月を取得できていれば `45 202301 202609`)、`districts per month [42]`、`全体 rows 0`、`generation mismatches 0`

- [ ] **Step 7: 公開用フォルダにコピーしてコミット**

```bash
cp data/district_population.csv docs/data/district_population.csv
git add scripts/urasoe_district_population.py tests/test_district_population.py data/district_population.csv docs/data/district_population.csv
git commit -m "feat: collect district-level population from the city's opendata CSV"
```

---

### Task 3: 地区別データのパースと順位付け(`docs/lib.js`)

**Files:**
- Modify: `docs/lib.js`(末尾に追加)
- Test: `tests/lib.test.mjs`(import と末尾にテストを追加)

**Interfaces:**
- Consumes(Task 2): `district_population.csv` の形式(ヘッダー `year_month,district,total,male,female,households,child,working,elderly`、UTF-8)
- Produces(Task 4が使う):
  - `parseDistrictCsvText(text: string): Array<{year_month: string, district: string, total: number, male: number, female: number, households: number, child: number, working: number, elderly: number}>`
  - `districtRankingForMonth(records, ym: string, metric: "total" | "elderlyRate"): Array<{district: string, value: number, total: number}>` — `value`は`metric === "total"`なら人数、`"elderlyRate"`なら0〜1の小数。`value`の降順、同じ値なら地区名の昇順(`localeCompare(..., "ja")`)。該当年月がなければ`[]`。それ以外の`metric`は`Error`を投げる

- [ ] **Step 1: 失敗するテストを書く**

`tests/lib.test.mjs` の import に2つ追加する:

```javascript
import {
  parseCsvText,
  listYearMonths,
  pyramidDataForMonth,
  pyramidDataByDecade,
  ageGroupTotals,
  summaryForMonth,
  sharedScaleRanges,
  trendReport,
  parseDistrictCsvText,
  districtRankingForMonth,
} from "../docs/lib.js";
```

ファイル末尾に追加:

```javascript
const DISTRICT_CSV = `year_month,district,total,male,female,households,child,working,elderly
202301,仲間,100,50,50,40,20,60,20
202301,牧港,300,150,150,120,30,200,70
202301,キャンプキンザー,10,5,5,4,0,4,6
202302,仲間,101,50,51,40,20,61,20
`;

test("parseDistrictCsvText parses the normalized district file into typed records", () => {
  const records = parseDistrictCsvText(DISTRICT_CSV);
  assert.equal(records.length, 4);
  assert.deepEqual(records[0], {
    year_month: "202301",
    district: "仲間",
    total: 100,
    male: 50,
    female: 50,
    households: 40,
    child: 20,
    working: 60,
    elderly: 20,
  });
});

test("parseDistrictCsvText reads quoted values containing commas and quotes", () => {
  const csv = `year_month,district,total,male,female,households,child,working,elderly
202301,"浦添,""テスト""団地",10,5,5,4,1,8,1
`;
  assert.equal(parseDistrictCsvText(csv)[0].district, '浦添,"テスト"団地');
});

test("parseDistrictCsvText skips rows with empty or non-numeric cells", () => {
  const csv = `year_month,district,total,male,female,households,child,working,elderly
202301,仲間,,50,50,40,20,60,20
202301,牧港,x,150,150,120,30,200,70
202301,城間,10,5,5,4,1,8,1
`;
  assert.deepEqual(
    parseDistrictCsvText(csv).map((r) => r.district),
    ["城間"]
  );
});

test("parseDistrictCsvText returns [] when a required column is missing", () => {
  const csv = `year_month,district,total
202301,仲間,100
`;
  assert.deepEqual(parseDistrictCsvText(csv), []);
});

test("districtRankingForMonth sorts districts by total population, largest first", () => {
  const ranking = districtRankingForMonth(parseDistrictCsvText(DISTRICT_CSV), "202301", "total");
  assert.deepEqual(ranking, [
    { district: "牧港", value: 300, total: 300 },
    { district: "仲間", value: 100, total: 100 },
    { district: "キャンプキンザー", value: 10, total: 10 },
  ]);
});

test("districtRankingForMonth sorts by elderly rate and keeps each district's population", () => {
  const ranking = districtRankingForMonth(parseDistrictCsvText(DISTRICT_CSV), "202301", "elderlyRate");
  assert.deepEqual(
    ranking.map((r) => r.district),
    ["キャンプキンザー", "牧港", "仲間"]
  );
  assert.equal(ranking[0].value, 6 / 10);
  assert.equal(ranking[0].total, 10);
});

test("districtRankingForMonth breaks ties by district name", () => {
  const csv = `year_month,district,total,male,female,households,child,working,elderly
202301,い地区,10,5,5,4,1,8,1
202301,あ地区,10,5,5,4,1,8,1
`;
  assert.deepEqual(
    districtRankingForMonth(parseDistrictCsvText(csv), "202301", "total").map((r) => r.district),
    ["あ地区", "い地区"]
  );
});

test("districtRankingForMonth leaves out zero-population districts when ranking by rate", () => {
  const csv = `year_month,district,total,male,female,households,child,working,elderly
202301,空き地区,0,0,0,0,0,0,0
202301,仲間,10,5,5,4,1,8,1
`;
  assert.deepEqual(
    districtRankingForMonth(parseDistrictCsvText(csv), "202301", "elderlyRate").map((r) => r.district),
    ["仲間"]
  );
});

test("districtRankingForMonth returns [] for a month with no district data", () => {
  assert.deepEqual(districtRankingForMonth(parseDistrictCsvText(DISTRICT_CSV), "202212", "total"), []);
});

test("districtRankingForMonth rejects an unknown metric", () => {
  assert.throws(() => districtRankingForMonth([], "202301", "households"), /unknown metric/);
});
```

- [ ] **Step 2: テストを実行し、失敗することを確認する**

Run: `node --test tests/lib.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../docs/lib.js' does not provide an export named 'parseDistrictCsvText'`

- [ ] **Step 3: 実装する**

`docs/lib.js` の末尾に追加:

```javascript
const DISTRICT_NUMERIC_FIELDS = ["total", "male", "female", "households", "child", "working", "elderly"];

// Python's csv module quotes a value only when it contains a comma, quote or
// newline; this handles that quoting ("" is an escaped quote).
function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

const toNumber = (s) => (s === undefined || s.trim() === "" ? NaN : Number(s));

export function parseDistrictCsvText(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]);
  const fields = ["year_month", "district", ...DISTRICT_NUMERIC_FIELDS];
  const idx = Object.fromEntries(fields.map((f) => [f, header.indexOf(f)]));
  if (fields.some((f) => idx[f] === -1)) {
    console.warn("parseDistrictCsvText: missing required column in header");
    return [];
  }
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const record = {
      year_month: (cols[idx.year_month] ?? "").trim(),
      district: (cols[idx.district] ?? "").trim(),
    };
    for (const f of DISTRICT_NUMERIC_FIELDS) record[f] = toNumber(cols[idx[f]]);
    if (!record.year_month || !record.district || DISTRICT_NUMERIC_FIELDS.some((f) => !Number.isFinite(record[f]))) {
      console.warn(`skipping unparseable district row: ${lines[i]}`);
      continue;
    }
    records.push(record);
  }
  return records;
}

export function districtRankingForMonth(records, ym, metric) {
  if (metric !== "total" && metric !== "elderlyRate") throw new Error(`unknown metric: ${metric}`);
  return records
    .filter((r) => r.year_month === ym && (metric === "total" || r.total > 0))
    .map((r) => ({
      district: r.district,
      value: metric === "total" ? r.total : r.elderly / r.total,
      total: r.total,
    }))
    .sort((a, b) => b.value - a.value || a.district.localeCompare(b.district, "ja"));
}
```

- [ ] **Step 4: テストを実行し、成功することを確認する**

Run: `node --test tests/lib.test.mjs`
Expected: 27件すべて PASS(既存17件 + このタスクの10件)。出力に `skipping unparseable district row` と `missing required column` の警告が出るのは、意図して不正な行を渡しているテストの分なので正常

- [ ] **Step 5: 実データでパースできることを確認する**

Run:

```bash
node --input-type=module -e "
import { parseDistrictCsvText, districtRankingForMonth } from './docs/lib.js';
import fs from 'fs';
const recs = parseDistrictCsvText(fs.readFileSync('docs/data/district_population.csv', 'utf-8'));
console.log('records', recs.length);
const top = districtRankingForMonth(recs, '202608', 'total').slice(0, 3);
console.log(JSON.stringify(top));
"
```

Expected: `records` が「月数 × 42」(44か月なら1848)、上位3件が宮城(9624)・内間(9170)・前田(5780)の順

- [ ] **Step 6: コミット**

```bash
git add docs/lib.js tests/lib.test.mjs
git commit -m "feat: parse and rank district population data"
```

---

### Task 4: ダッシュボードに地区別人口ランキングを追加

**Files:**
- Modify: `docs/index.html`(`#pyramid-section` の直後に新セクション)
- Modify: `docs/style.css`(末尾に追加)
- Modify: `docs/app.js`(import、DOM参照、描画関数、`main()`)
- Test: `tests/app_smoke.test.mjs`(新規。ブラウザが使えない環境のため、簡易DOMで`app.js`を実際に動かして配線を確かめる)

**Interfaces:**
- Consumes(Task 3): `parseDistrictCsvText`, `districtRankingForMonth`(シグネチャはTask 3参照)
- Consumes(既存 `app.js`): `listYearMonths`(lib.js)、`fmt`, `ymLabel`(app.js内のヘルパー)、`selectEl`
- Produces(HTMLのid、smokeテストが参照): `district-section`, `district-metric`(`<select>`、選択肢の値は`total`と`elderlyRate`), `district-message`, `district-chart-wrap`, `district-chart`

- [ ] **Step 1: 失敗するテストを書く**

`tests/app_smoke.test.mjs` を作成:

```javascript
// docs/app.js をブラウザなしで動かすための簡易DOM。グラフの見た目は確かめられないが、
// データの流れ・メッセージ・Chart.jsに渡す設定は確かめられる。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_URL = pathToFileURL(path.join(ROOT, "docs", "app.js")).href;

const CITY_CSV = `year_month,age,male,female,total,source_url
202212,0,5,5,10,x
202212,70,3,3,6,x
202301,0,5,4,9,x
202301,70,3,4,7,x
202302,0,4,4,8,x
202302,70,4,4,8,x
`;

const DISTRICT_CSV = `year_month,district,total,male,female,households,child,working,elderly
202301,仲間,100,50,50,40,20,60,20
202301,牧港,300,150,150,120,30,200,70
202301,キャンプキンザー,10,5,5,4,0,4,6
`;

function makeElement() {
  const el = {
    hidden: false,
    value: "",
    children: [],
    listeners: {},
    _text: "",
    get textContent() {
      return el.children.length
        ? el.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("")
        : el._text;
    },
    set textContent(v) {
      el._text = String(v);
      el.children = [];
    },
    append(...parts) {
      el.children.push(...parts);
    },
    appendChild(child) {
      el.children.push(child);
    },
    replaceChildren(...parts) {
      el.children = parts;
    },
    addEventListener(type, fn) {
      (el.listeners[type] ??= []).push(fn);
    },
    dispatch(type) {
      for (const fn of el.listeners[type] ?? []) fn();
    },
  };
  return el;
}

let caseCounter = 0;

async function loadApp({ districtCsv }) {
  const elements = {
    "error-message": Object.assign(makeElement(), { hidden: true }),
    "district-metric": Object.assign(makeElement(), { value: "total" }),
  };
  const charts = {};
  const idOf = (el) => Object.keys(elements).find((k) => elements[k] === el);
  globalThis.document = {
    getElementById: (id) => (elements[id] ??= makeElement()),
    createElement: () => makeElement(),
  };
  globalThis.Chart = class {
    constructor(canvas, config) {
      this.data = config.data;
      this.options = config.options;
      charts[idOf(canvas)] = this;
    }
    update() {}
  };
  globalThis.fetch = async (url) => {
    const body = url.includes("district_population") ? districtCsv : CITY_CSV;
    if (body === null) return { ok: false, status: 404, text: async () => "" };
    return { ok: true, text: async () => body };
  };
  // クエリを変えると、app.js が新しいモジュールとして読み込まれ直す
  await import(`${APP_URL}?case=${++caseCounter}`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { elements, charts };
}

function selectMonth(elements, ym) {
  elements["year-month-select"].value = ym;
  elements["year-month-select"].dispatch("change");
}

test("the latest city month has no district data yet, so the section says so", async () => {
  const { elements } = await loadApp({ districtCsv: DISTRICT_CSV });
  assert.equal(elements["year-month-select"].value, "202302");
  assert.equal(elements["district-message"].hidden, false);
  assert.equal(elements["district-message"].textContent, "2023年2月の地区別データはまだありません。");
  assert.equal(elements["district-chart-wrap"].hidden, true);
});

test("a month with district data shows districts ranked by population", async () => {
  const { elements, charts } = await loadApp({ districtCsv: DISTRICT_CSV });
  selectMonth(elements, "202301");
  const chart = charts["district-chart"];
  assert.deepEqual(chart.data.labels, ["牧港", "仲間", "キャンプキンザー"]);
  assert.deepEqual(chart.data.datasets[0].data, [300, 100, 10]);
  assert.equal(chart.options.scales.y.ticks.autoSkip, false);
  assert.equal(elements["district-message"].hidden, true);
  assert.equal(elements["district-chart-wrap"].hidden, false);
});

test("switching to elderly rate re-sorts and the tooltip shows the district's population", async () => {
  const { elements, charts } = await loadApp({ districtCsv: DISTRICT_CSV });
  selectMonth(elements, "202301");
  elements["district-metric"].value = "elderlyRate";
  elements["district-metric"].dispatch("change");
  const chart = charts["district-chart"];
  assert.deepEqual(chart.data.labels, ["キャンプキンザー", "牧港", "仲間"]);
  assert.equal(chart.data.datasets[0].data[0], 60);
  assert.equal(chart.options.plugins.tooltip.callbacks.label({ dataIndex: 0 }), "高齢化率 60.0%(総人口 10人)");
});

test("a month before the district data starts explains when it becomes available", async () => {
  const { elements } = await loadApp({ districtCsv: DISTRICT_CSV });
  selectMonth(elements, "202212");
  assert.equal(elements["district-message"].textContent, "地区別データは2023年1月以降のみ利用可能です。");
  assert.equal(elements["district-chart-wrap"].hidden, true);
});

test("if the district file fails to load, the city dashboard still works", async () => {
  const { elements } = await loadApp({ districtCsv: null });
  assert.equal(elements["district-message"].textContent, "地区別データを読み込めませんでした。");
  assert.equal(elements["error-message"].hidden, true);
  assert.equal(elements["summary-total"].textContent, "16");
  assert.equal(elements["card-child-count"].textContent, "8");
});

test("every id app.js looks up exists in index.html", () => {
  const app = fs.readFileSync(path.join(ROOT, "docs", "app.js"), "utf-8");
  const html = fs.readFileSync(path.join(ROOT, "docs", "index.html"), "utf-8");
  const ids = [...app.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(ids.includes("district-chart"));
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `index.html is missing id="${id}"`);
});
```

- [ ] **Step 2: テストを実行し、失敗することを確認する**

Run: `node --test tests/app_smoke.test.mjs`
Expected: 6件すべてFAIL(地区別の5件は `district-message` が空のまま・`charts["district-chart"]` が `undefined` などで落ち、id確認の1件は `app.js` にまだ `district-chart` がないので落ちる)

- [ ] **Step 3: HTMLにセクションを追加する**

`docs/index.html` の `#pyramid-section` の閉じタグ `</section>` の直後に追加:

```html
    <section id="district-section">
      <h2>地区別人口ランキング</h2>
      <p class="district-note">選択した年月の、市内の地区ごとの値です。地区別データは市の別の公開ファイルに基づくため、地区の合計が上の総人口と数十人ずれることがあります。</p>
      <label for="district-metric">並べる指標</label>
      <select id="district-metric">
        <option value="total">総人口</option>
        <option value="elderlyRate">高齢化率</option>
      </select>
      <p class="district-message" id="district-message" hidden></p>
      <div id="district-chart-wrap" style="height: 900px;">
        <canvas id="district-chart"></canvas>
      </div>
    </section>
```

- [ ] **Step 4: スタイルを追加する**

`docs/style.css` の末尾に追加:

```css
.district-note {
  font-size: 0.85rem;
  opacity: 0.75;
  margin-block: 0 0.75rem;
}

#district-metric {
  margin-inline-start: 0.5rem;
}

.district-message {
  margin-block: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 4px;
  background: color-mix(in srgb, currentColor 8%, transparent);
}
```

- [ ] **Step 5: `app.js` に描画処理を追加する**

import に2つ追加:

```javascript
import {
  parseCsvText,
  listYearMonths,
  pyramidDataByDecade,
  ageGroupTotals,
  summaryForMonth,
  sharedScaleRanges,
  trendReport,
  parseDistrictCsvText,
  districtRankingForMonth,
} from "./lib.js";
```

`const GENERATION_PIE_LABELS = ...;` の次の行に追加:

```javascript
const DISTRICT_COLORS = { total: "#6b7280", elderlyRate: GENERATION_COLORS.elderly };
```

`const totalEl = document.getElementById("summary-total");` の次の行に追加:

```javascript
const metricEl = document.getElementById("district-metric");
const districtMessageEl = document.getElementById("district-message");
const districtChartWrap = document.getElementById("district-chart-wrap");
```

`const trendCharts = { ... };` の次の行に追加:

```javascript
let districtChart;
```

`function renderSummary(records, ym) {` の直前に追加:

```javascript
async function loadDistrictRecords() {
  try {
    const response = await fetch(`./data/district_population.csv?t=${Date.now()}`);
    if (!response.ok) return null;
    return parseDistrictCsvText(await response.text());
  } catch {
    return null;
  }
}

function showDistrictMessage(text) {
  districtMessageEl.textContent = text;
  districtMessageEl.hidden = false;
  districtChartWrap.hidden = true;
}

function districtTooltip(entry, isRate) {
  return isRate
    ? `高齢化率 ${(entry.value * 100).toFixed(1)}%(総人口 ${fmt(entry.total)}人)`
    : `総人口 ${fmt(entry.total)}人`;
}

function renderDistrict(records, ym, metric) {
  if (records === null) {
    showDistrictMessage("地区別データを読み込めませんでした。");
    return;
  }
  const ranking = districtRankingForMonth(records, ym, metric);
  if (ranking.length === 0) {
    const months = listYearMonths(records);
    showDistrictMessage(
      months.length > 0 && ym < months[0]
        ? `地区別データは${ymLabel(months[0])}以降のみ利用可能です。`
        : `${ymLabel(ym)}の地区別データはまだありません。`
    );
    return;
  }
  districtMessageEl.hidden = true;
  // 非表示の要素の中で作ると幅0のグラフになるので、先に表示してから描く
  districtChartWrap.hidden = false;

  const isRate = metric === "elderlyRate";
  const data = {
    labels: ranking.map((r) => r.district),
    datasets: [
      {
        label: isRate ? "高齢化率" : "総人口",
        data: ranking.map((r) => (isRate ? r.value * 100 : r.value)),
        backgroundColor: DISTRICT_COLORS[metric],
      },
    ],
  };
  const options = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => districtTooltip(ranking[ctx.dataIndex], isRate) } },
    },
    scales: {
      x: { ticks: { callback: (v) => (isRate ? `${v}%` : fmt(v)) } },
      // 地区名を間引かずに全部出す
      y: { ticks: { autoSkip: false } },
    },
  };
  if (districtChart) {
    districtChart.data = data;
    districtChart.options = options;
    districtChart.update();
  } else {
    districtChart = new Chart(document.getElementById("district-chart"), { type: "bar", data, options });
  }
}
```

`main()` を変更する。最初の `let response;` の直前に1行追加:

```javascript
  const districtPromise = loadDistrictRecords();
```

`main()` の最後の `onMonthChange(records, groupTotals);` の後に追加:

```javascript

  const districtRecords = await districtPromise;
  const renderDistrictForSelection = () => {
    try {
      renderDistrict(districtRecords, selectEl.value, metricEl.value);
    } catch (err) {
      console.warn("district ranking failed", err);
      showDistrictMessage("地区別データを読み込めませんでした。");
    }
  };
  selectEl.addEventListener("change", renderDistrictForSelection);
  metricEl.addEventListener("change", renderDistrictForSelection);
  renderDistrictForSelection();
```

- [ ] **Step 6: テストを実行し、成功することを確認する**

Run: `node --check docs/app.js && node --test tests/lib.test.mjs tests/app_smoke.test.mjs`
Expected: 構文OK、33件すべて PASS(lib 27件 + smoke 6件)

- [ ] **Step 7: 実データでの表示を簡易DOMで確認する**

Run:

```bash
node --input-type=module -e "
import fs from 'fs';
import { parseDistrictCsvText, districtRankingForMonth } from './docs/lib.js';
const recs = parseDistrictCsvText(fs.readFileSync('docs/data/district_population.csv', 'utf-8'));
const rate = districtRankingForMonth(recs, '202608', 'elderlyRate');
console.log('districts', rate.length);
console.log('highest rate', rate[0].district, (rate[0].value * 100).toFixed(1) + '%', rate[0].total + '人');
console.log('lowest rate', rate.at(-1).district, (rate.at(-1).value * 100).toFixed(1) + '%', rate.at(-1).total + '人');
"
```

Expected: `districts 42`。最高・最低の地区名と人数が出る(値は作業報告に書く。人数がごく少ない地区が上位に来ていれば、ツールチップに人数を出す設計が意味を持つことの確認になる)

- [ ] **Step 8: ローカルサーバーで表示を確認する**

Run: `python scripts/dev_server.py 8000`(別ターミナル、またはバックグラウンド)
ブラウザで `http://localhost:8000/` を開き、次を確認する(ブラウザが使えない環境では、このステップは「未確認」と報告し、ユーザーに目視確認を依頼する):
- 最新月(2026年8月など)で、地区別ランキングに42地区が多い順に並び、地区名が間引かれずに全部表示される
- 「並べる指標」を高齢化率に変えると並びが変わり、ツールチップに人数が出る
- 年月を2022年12月以前にすると「地区別データは2023年1月以降のみ利用可能です。」が出る
- 上のカード・円グラフ・ピラミッド・推移・傾向レポートは今までどおり表示される

- [ ] **Step 9: コミット**

```bash
git add docs/index.html docs/style.css docs/app.js tests/app_smoke.test.mjs
git commit -m "feat: add district population ranking to the dashboard"
```

---

### Task 5: 月次ワークフローとREADMEの更新

**Files:**
- Modify: `.github/workflows/monthly-fetch.yml`(28〜38行目)
- Modify: `README.md`

**Interfaces:**
- Consumes(Task 2): `python scripts/urasoe_district_population.py latest --lookback 3`、出力 `data/district_population.csv`
- Consumes(Task 1・2): Pythonテストの実行コマンド

- [ ] **Step 1: ワークフローを変更する**

`.github/workflows/monthly-fetch.yml` の「Fetch latest months」ステップと「Sync data to docs/ for GitHub Pages」ステップ(28〜38行目)を、次で置き換える:

```yaml
      - name: Fetch latest months
        run: python scripts/urasoe_population.py latest --lookback 3

      - name: Fetch latest district months
        run: python scripts/urasoe_district_population.py latest --lookback 3

      - name: Sync data to docs/ for GitHub Pages
        run: |
          mkdir -p docs/data
          for f in population_by_age.csv district_population.csv; do
            if [ -f "data/$f" ]; then
              cp "data/$f" "docs/data/$f"
            else
              echo "data/$f がまだ存在しないためスキップ"
            fi
          done
```

「Commit and push if changed」ステップは変更しない(`git add data/ docs/data/` で新しいCSVも含まれる)。

- [ ] **Step 2: YAMLの構文とコピー処理を確認する**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/monthly-fetch.yml', encoding='utf-8')); print('yaml ok')"`
(`ModuleNotFoundError: No module named 'yaml'` の場合は先に `pip install pyyaml`)
Expected: `yaml ok`

Run(Git Bashで、Step 1のコピー処理をそのまま実行):

```bash
mkdir -p docs/data
for f in population_by_age.csv district_population.csv; do
  if [ -f "data/$f" ]; then cp "data/$f" "docs/data/$f"; else echo "data/$f がまだ存在しないためスキップ"; fi
done
git status --porcelain docs/data/
```

Expected: 出力なし(Task 2でコピー済みと同じ内容なので差分が出ない)

- [ ] **Step 3: READMEに地区別データの説明を追加する**

`README.md` の「セットアップ手順」の手順3のコードブロック(`python scripts/urasoe_population.py backfill ...` の行)の直後の行に、次の1行をコードブロック内に追加する:

```bash
   python scripts/urasoe_district_population.py backfill --start 2023-01 --end 2026-09
```

「## データの形式」セクションの表の後に追加:

```markdown
`data/district_population.csv`(行政区別、2023年1月分以降)

| 列 | 内容 |
|---|---|
| year_month | 集計年月(例: `202608`) |
| district | 行政区の名前(例: `仲間`)。市全体の合計行は含まない |
| total / male / female | 総人口・男性・女性 |
| households | 世帯数 |
| child / working / elderly | 年少(0-14)・生産年齢(15-64)・高齢(65以上) |

市の「地域・年齢別人口」オープンデータCSV(`{年月}opendata.csv`、Shift-JIS)を
`scripts/urasoe_district_population.py` が取り込んで作る。このCSVは2023年1月分から
しか公開されていないため、市全体のデータ(2021年1月〜)より開始が遅い。
```

「## 既知の注意点」セクションの最初の項目(`URL_TEMPLATES` に触れている3行)を、`URL_TEMPLATES` がなくなったので次で置き換える。置き換える前の3行:

```markdown
- 浦添市サイトのURL構造が過去に変わっているため、スクリプトは複数の候補URL
  パターンを順に試します。将来的にまたURLが変わった場合は
  `scripts/urasoe_population.py` の `URL_TEMPLATES` にパターンを追加してください。
```

置き換えた後:

```markdown
- 浦添市サイトはファイルの置き場所のページが年ごとに変わるため、スクリプトは
  複数の候補URLを順に試します。新しい年のページができたら
  `scripts/urasoe_common.py` の `BASE_URLS` に1行追加すれば、
  市全体・地区別の両方のスクリプトが対応します。
```

「## 既知の注意点」セクションの最後に追加:

```markdown
- テストの実行: `python -m unittest discover -s tests -p "test_*.py"`(Python)、
  `node --test tests/lib.test.mjs tests/app_smoke.test.mjs`(JavaScript)
```

- [ ] **Step 4: 全テストを実行する**

Run: `python -m unittest discover -s tests -p "test_*.py" && node --test tests/lib.test.mjs tests/app_smoke.test.mjs`
Expected: Python 16件・JavaScript 33件すべて PASS

- [ ] **Step 5: コミット**

```bash
git add .github/workflows/monthly-fetch.yml README.md
git commit -m "chore: fetch district data monthly and document it"
```

---

## 完了条件

- [ ] `python -m unittest discover -s tests -p "test_*.py"` が16件PASS
- [ ] `node --test tests/lib.test.mjs tests/app_smoke.test.mjs` が33件PASS
- [ ] `data/district_population.csv` と `docs/data/district_population.csv` が同じ内容で、各月42地区・`全体`行なし・年齢3区分の合計が総人口と一致
- [ ] ローカルで表示を確認(ブラウザが使えない環境ではユーザーに目視確認を依頼)
- [ ] pushと公開サイトへの反映は、ユーザーの了承を得てから行う
