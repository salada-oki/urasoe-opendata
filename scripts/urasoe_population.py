#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
浦添市「指定区別年齢別男女別人口調（全体）」PDFを取得・パースし、
data/population_by_age.csv に年齢別（0〜105+）・男女別・年月別で蓄積する。

使い方:
    # 過去分をまとめて取得（初回バックフィル用）
    python scripts/urasoe_population.py backfill --start 2021-01 --end 2026-09

    # 直近数ヶ月だけチェック（GitHub Actionsの定期実行用）
    python scripts/urasoe_population.py latest --lookback 3

出力: data/population_by_age.csv
  列: year_month, age, male, female, total, source_url
"""

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


def parse_pdf(pdf_bytes: bytes, ym: str, source_url: str):
    """PDFの座標情報をもとに行を再構成し、年齢・男・女・計の4つ組を抽出する。"""
    records = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page = pdf.pages[0]
        words = page.extract_words(use_text_flow=False, keep_blank_chars=False)

        # 同じ行とみなす許容誤差（pt単位）
        tol = 2.5
        words.sort(key=lambda w: (w["top"], w["x0"]))

        rows = []
        current_row = []
        last_top = None
        for w in words:
            if last_top is None or abs(w["top"] - last_top) <= tol:
                current_row.append(w)
            else:
                rows.append(current_row)
                current_row = [w]
            last_top = w["top"]
        if current_row:
            rows.append(current_row)

        seen_ages = set()
        for row in rows:
            row_sorted = sorted(row, key=lambda w: w["x0"])
            tokens = [w["text"] for w in row_sorted]

            # 行の中から「純粋な数字（カンマ含む）」のトークンだけを抜き出す。
            # 見出し文字列（年齢/男/女/計、0～4、65以上、平均年齢 など）は
            # 数字以外の文字を含むため自然に除外される。
            numeric_tokens = [t for t in tokens if NUM_RE.match(t)]

            # 年齢テーブルの各行は「年齢・男・女・計」の4つ組がブロック数だけ
            # 横に並ぶ（4つ組×最大4ブロック=最大16個）。4の倍数の場合のみ処理。
            if len(numeric_tokens) >= 4 and len(numeric_tokens) % 4 == 0:
                for i in range(0, len(numeric_tokens), 4):
                    age_s, male_s, female_s, total_s = numeric_tokens[i : i + 4]
                    try:
                        age = int(age_s)
                        male = int(male_s.replace(",", ""))
                        female = int(female_s.replace(",", ""))
                        total = int(total_s.replace(",", ""))
                    except ValueError:
                        continue
                    # 年齢は0〜105程度、整合性チェック（male+female==total）
                    if 0 <= age <= 110 and male + female == total and age not in seen_ages:
                        seen_ages.add(age)
                        records.append(
                            {
                                "year_month": ym,
                                "age": age,
                                "male": male,
                                "female": female,
                                "total": total,
                                "source_url": source_url,
                            }
                        )
    return records



def process_months(year_months, skip_existing=True, sleep_sec=1.0):
    existing = load_existing_year_months(CSV_PATH) if skip_existing else set()
    total_added = 0
    for ym in year_months:
        if ym in existing:
            print(f"[skip] {ym} は取得済み")
            continue
        pdf_bytes, url = fetch_pdf_bytes(ym)
        if pdf_bytes is None:
            print(f"[none] {ym} のPDFは見つかりませんでした（未公開の可能性）")
            continue
        records = parse_pdf(pdf_bytes, ym, url)
        if not records:
            print(f"[warn] {ym} はPDF取得できたがパースに失敗（要確認）: {url}")
            continue
        # 0〜99歳が全部揃っているか簡易チェック（PDFのレイアウト崩れで
        # 一部の年齢だけ整合性チェックに落ちて欠落することがあるため）
        got_ages = {r["age"] for r in records}
        missing = sorted(set(range(0, 100)) - got_ages)
        if missing:
            print(f"[warn] {ym} は 0〜99歳のうち {len(missing)}件が欠落: {missing}")
        append_records(CSV_PATH, FIELDNAMES, records)
        total_added += len(records)
        print(f"[ok]   {ym} : {len(records)}行 追加 ({url})")
        time.sleep(sleep_sec)  # サーバーへの負荷配慮
    print(f"合計 {total_added} 行を追加しました。")


def cmd_backfill(args):
    year_months = list(month_iter(args.start, args.end))
    process_months(year_months, skip_existing=not args.force)


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

    p_latest = sub.add_parser("latest", help="直近nヶ月だけチェック（定期実行用）")
    p_latest.add_argument("--lookback", type=int, default=3, help="何ヶ月さかのぼって確認するか")
    p_latest.add_argument("--force", action="store_true", help="既存行があっても再取得する")
    p_latest.set_defaults(func=cmd_latest)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    sys.exit(main())
