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
