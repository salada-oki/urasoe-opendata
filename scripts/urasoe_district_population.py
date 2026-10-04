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
    if city_total is None and records:
        warnings.append(f"「{TOTAL_ROW_NAME}」行がありません(ファイルが途中で切れている可能性があります)")
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
