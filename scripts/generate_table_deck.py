#!/usr/bin/env python3
"""
まとめHTMLから表を抽出してテーブル穴埋めデッキを生成するスクリプト

highlightベース精選版:
- <span class="highlight">タグを含むセルのみを穴埋め対象にする
- highlightがない表はスキップ
"""

import os
import json
import re
from bs4 import BeautifulSoup
from pathlib import Path

# highlightがない表の情報を収集するグローバル変数
no_highlight_tables = []

def extract_tables_from_html(html_path, collect_no_highlight=False):
    """HTMLファイルから表を抽出

    Args:
        html_path: HTMLファイルのパス
        collect_no_highlight: highlightがない表を収集するかどうか
    """
    global no_highlight_tables

    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()

    soup = BeautifulSoup(html, 'html.parser')

    # タイトルを取得
    title_el = soup.find('h1')
    page_title = title_el.get_text(strip=True) if title_el else Path(html_path).stem

    # カテゴリタグを取得
    category_tag = soup.find('span', class_='category-tag')
    category = category_tag.get_text(strip=True) if category_tag else ''

    tables_data = []
    tables = soup.find_all('table')

    for table_idx, table in enumerate(tables):
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

        # データ行（テキストとセル要素を保持）
        data_rows = []
        data_row_elements = []
        for row in rows[1:]:
            cells = row.find_all(['td', 'th'])
            values = [cell.get_text(strip=True) for cell in cells]
            if len(values) >= 2:
                data_rows.append(values)
                data_row_elements.append(cells)

        if not data_rows:
            continue

        # highlightを含むセルのみを穴埋め対象に
        occlusions = []
        for row_idx, cells in enumerate(data_row_elements):
            for col_idx, cell in enumerate(cells):
                if col_idx == 0:  # キー列はスキップ
                    continue
                # highlightタグを含むセルのみ
                if cell.find('span', class_='highlight'):
                    occlusions.append({"row": row_idx, "col": col_idx})

        # highlightがない表はスキップ（情報収集モードの場合は記録）
        if not occlusions:
            if collect_no_highlight:
                no_highlight_tables.append({
                    "file": str(html_path),
                    "pageTitle": page_title,
                    "section": section,
                    "tableIndex": table_idx,
                    "headers": headers,
                    "rowCount": len(data_rows)
                })
            continue

        tables_data.append({
            "title": section,
            "table": {
                "headers": headers,
                "rows": data_rows
            },
            "occlusions": occlusions
        })

    return {
        "pageTitle": page_title,
        "category": category,
        "tables": tables_data
    }


def generate_deck_from_html(html_path, output_dir, collect_no_highlight=False):
    """HTMLからデッキJSONを生成"""
    data = extract_tables_from_html(html_path, collect_no_highlight)

    if not data["tables"]:
        return None

    # 相対パスを計算
    html_rel_path = os.path.relpath(html_path, output_dir)

    deck = {
        "type": "table-occlusion-deck",
        "version": 1,
        "source": html_rel_path,
        "pageTitle": data["pageTitle"],
        "category": data["category"],
        "cards": []
    }

    for table_data in data["tables"]:
        card = {
            "type": "table-occlusion",
            "title": table_data["title"],
            "table": table_data["table"],
            "occlusions": table_data["occlusions"]
        }
        deck["cards"].append(card)

    return deck


def process_subject_folder(subject_path, output_dir, collect_no_highlight=False):
    """科目フォルダ内の全HTMLを処理"""
    subject_name = os.path.basename(subject_path)
    all_cards = []

    html_files = sorted(Path(subject_path).glob('*.html'))

    for html_path in html_files:
        deck = generate_deck_from_html(str(html_path), output_dir, collect_no_highlight)
        if deck and deck["cards"]:
            for card in deck["cards"]:
                card["source"] = deck["source"]
                card["pageTitle"] = deck["pageTitle"]
                card["category"] = deck["category"]
                all_cards.append(card)

    if not all_cards:
        return None

    return {
        "type": "table-occlusion-deck",
        "version": 1,
        "subject": subject_name,
        "cardCount": len(all_cards),
        "occlusionCount": sum(len(c["occlusions"]) for c in all_cards),
        "cards": all_cards
    }


def main():
    global no_highlight_tables

    import argparse
    import csv

    parser = argparse.ArgumentParser(description='まとめHTMLからテーブル穴埋めデッキを生成（highlightベース精選版）')
    parser.add_argument('input', help='HTMLファイルまたは科目フォルダ')
    parser.add_argument('-o', '--output', help='出力先', default='.')
    parser.add_argument('--preview', action='store_true', help='プレビューのみ（ファイル出力しない）')
    parser.add_argument('--report-no-highlight', metavar='CSV_PATH',
                        help='highlightがない表の一覧をCSV出力')
    args = parser.parse_args()

    input_path = args.input
    output_dir = args.output
    collect_no_highlight = args.report_no_highlight is not None

    # highlightなし表のリストをリセット
    no_highlight_tables = []

    if os.path.isfile(input_path):
        # 単一HTMLファイル
        deck = generate_deck_from_html(input_path, output_dir, collect_no_highlight)
        if deck:
            if args.preview:
                print(json.dumps(deck, ensure_ascii=False, indent=2))
            else:
                output_name = Path(input_path).stem + '_table_deck.json'
                output_path = os.path.join(output_dir, output_name)
                with open(output_path, 'w', encoding='utf-8') as f:
                    json.dump(deck, f, ensure_ascii=False, indent=2)
                print(f"生成完了: {output_path}")
                print(f"  カード数: {len(deck['cards'])}")
                total_occlusions = sum(len(c['occlusions']) for c in deck['cards'])
                print(f"  穴埋め数: {total_occlusions}")
        else:
            print(f"警告: highlightを含む表がありません: {input_path}")

    elif os.path.isdir(input_path):
        # 科目フォルダ
        deck = process_subject_folder(input_path, output_dir, collect_no_highlight)
        if deck:
            if args.preview:
                # プレビュー時は最初の2カードだけ表示
                preview_deck = deck.copy()
                preview_deck["cards"] = deck["cards"][:2]
                print(json.dumps(preview_deck, ensure_ascii=False, indent=2))
                print(f"\n... 他 {len(deck['cards']) - 2} カード")
            else:
                subject_name = deck["subject"]
                output_name = f"{subject_name}_table_deck.json"
                output_path = os.path.join(output_dir, output_name)
                with open(output_path, 'w', encoding='utf-8') as f:
                    json.dump(deck, f, ensure_ascii=False, indent=2)
                print(f"生成完了: {output_path}")
                print(f"  カード数: {deck['cardCount']}")
                print(f"  穴埋め数: {deck['occlusionCount']}")
        else:
            print(f"警告: highlightを含む表がありません: {input_path}")

    # highlightなし表のレポートを出力
    if args.report_no_highlight and no_highlight_tables:
        with open(args.report_no_highlight, 'w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=['file', 'pageTitle', 'section', 'tableIndex', 'headers', 'rowCount'])
            writer.writeheader()
            for table_info in no_highlight_tables:
                table_info['headers'] = ' | '.join(table_info['headers'])
                writer.writerow(table_info)
        print(f"\nhighlightなし表レポート: {args.report_no_highlight}")
        print(f"  表の数: {len(no_highlight_tables)}")


if __name__ == '__main__':
    main()
