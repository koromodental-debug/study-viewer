#!/usr/bin/env python3
"""
まとめHTMLから表を抽出して対応する_QA.jsonに統合するスクリプト
"""

import os
import json
import re
from bs4 import BeautifulSoup
from pathlib import Path


def extract_tables_from_html(html_path):
    """HTMLファイルから表を抽出"""
    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()

    soup = BeautifulSoup(html, 'html.parser')

    # タイトルを取得
    title_el = soup.find('h1')
    page_title = title_el.get_text(strip=True) if title_el else Path(html_path).stem

    tables_data = []
    tables = soup.find_all('table')

    for table in tables:
        # 直前の見出しを取得
        prev_h2 = table.find_previous('h2')
        section = prev_h2.get_text(strip=True) if prev_h2 else page_title

        rows = table.find_all('tr')
        if len(rows) < 2:
            continue

        # ヘッダー行
        header_cells = rows[0].find_all(['th', 'td'])
        headers = [cell.get_text(strip=True) for cell in header_cells]

        if len(headers) < 2:
            continue

        # データ行
        data_rows = []
        for row in rows[1:]:
            cells = row.find_all(['td', 'th'])
            values = [cell.get_text(strip=True) for cell in cells]
            if len(values) >= 2:
                data_rows.append(values)

        if not data_rows:
            continue

        # 穴埋め対象セルを決定（ヘッダー列以外の全セル）
        occlusions = []
        for row_idx, row_data in enumerate(data_rows):
            for col_idx in range(1, len(row_data)):  # 0列目（キー）は除外
                if row_data[col_idx] and row_data[col_idx] != '-':
                    occlusions.append({"row": row_idx, "col": col_idx})

        if occlusions:  # 穴埋め対象がある場合のみ追加
            tables_data.append({
                "type": "table-occlusion",
                "title": section,
                "table": {
                    "headers": headers,
                    "rows": data_rows
                },
                "occlusions": occlusions
            })

    return tables_data


def find_matching_qa_json(html_path, qa_dir):
    """HTMLファイルに対応する_QA.jsonを探す"""
    html_stem = Path(html_path).stem  # 例: "01_不正咬合の分類と原因障害_Angleの分類法"

    # qaディレクトリ内を検索
    for qa_file in Path(qa_dir).glob('**/*_QA.json'):
        qa_stem = qa_file.stem.replace('_QA', '')  # 例: "01_不正咬合の分類と原因障害_Angleの分類法"
        if qa_stem == html_stem:
            return qa_file

    return None


def integrate_tables_to_qa(html_path, qa_json_path, dry_run=False):
    """表をQ&A JSONに統合"""
    # 表を抽出
    table_cards = extract_tables_from_html(html_path)

    if not table_cards:
        return None, "表なし"

    # Q&A JSONを読み込み
    with open(qa_json_path, 'r', encoding='utf-8') as f:
        qa_data = json.load(f)

    # 既存の表穴埋めセクションがあれば削除
    qa_data['sections'] = [s for s in qa_data.get('sections', []) if s.get('section') != '表穴埋め']

    # 表穴埋めセクションを追加
    table_section = {
        "section": "表穴埋め",
        "qa": table_cards
    }
    qa_data['sections'].append(table_section)

    if not dry_run:
        with open(qa_json_path, 'w', encoding='utf-8') as f:
            json.dump(qa_data, f, ensure_ascii=False, indent=2)

    return len(table_cards), f"{len(table_cards)}表追加"


def process_subject(subject_name, html_dir, qa_dir, dry_run=False):
    """科目全体を処理"""
    html_subject_dir = Path(html_dir) / subject_name
    qa_subject_dir = Path(qa_dir) / 'subject' / subject_name

    if not html_subject_dir.exists():
        print(f"HTMLディレクトリが見つかりません: {html_subject_dir}")
        return

    if not qa_subject_dir.exists():
        print(f"QAディレクトリが見つかりません: {qa_subject_dir}")
        return

    results = []
    total_tables = 0

    for html_file in sorted(html_subject_dir.glob('*.html')):
        qa_file = find_matching_qa_json(html_file, qa_subject_dir)

        if qa_file:
            count, msg = integrate_tables_to_qa(html_file, qa_file, dry_run)
            if count:
                total_tables += count
                results.append(f"  ✓ {html_file.stem}: {msg}")
            else:
                results.append(f"  - {html_file.stem}: {msg}")
        else:
            results.append(f"  ? {html_file.stem}: 対応するQAなし")

    print(f"\n=== {subject_name} ===")
    for r in results:
        print(r)
    print(f"\n合計: {total_tables}表を{'追加予定' if dry_run else '追加完了'}")

    return total_tables


def main():
    import argparse
    parser = argparse.ArgumentParser(description='まとめHTMLの表を_QA.jsonに統合')
    parser.add_argument('subject', help='科目名（例: 矯正）')
    parser.add_argument('--dry-run', action='store_true', help='実際には書き込まない')
    parser.add_argument('--html-dir', default='html/subject', help='HTMLディレクトリ')
    parser.add_argument('--qa-dir', default='qa', help='QAディレクトリ')
    args = parser.parse_args()

    # スクリプトのディレクトリからの相対パスを解決
    script_dir = Path(__file__).parent.parent  # study-viewer
    html_dir = script_dir / args.html_dir
    qa_dir = script_dir / args.qa_dir

    process_subject(args.subject, html_dir, qa_dir, args.dry_run)


if __name__ == '__main__':
    main()
