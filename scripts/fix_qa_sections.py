#!/usr/bin/env python3
"""
QAファイルのセクション名をHTMLのh3見出しに合わせて修正するスクリプト

使い方:
  python fix_qa_sections.py          # 不一致レポートのみ
  python fix_qa_sections.py --fix    # 自動修正も実行
"""

import os
import re
import json
import argparse
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_JS = BASE_DIR / "js" / "data.js"
QA_DIR = BASE_DIR / "qa"
HTML_DIR = BASE_DIR / "html"


def parse_data_js():
    """data.jsからqaPath→htmlPathのマッピングを取得"""
    with open(DATA_JS, "r", encoding="utf-8") as f:
        content = f.read()

    # DATA = [...] を抽出してJSONとしてパース
    match = re.search(r"const DATA = (\[[\s\S]*\]);?", content)
    if not match:
        raise ValueError("data.jsのパースに失敗")

    # JavaScriptの配列をJSONとしてパース
    data = json.loads(match.group(1))

    mapping = {}
    for item in data:
        qa_path = item.get("qaPath")
        html_path = item.get("htmlPath")
        if qa_path and html_path:
            mapping[qa_path] = html_path

    return mapping


def extract_qa_sections(qa_path):
    """QAファイルから ## セクション名 を抽出"""
    full_path = BASE_DIR / qa_path
    if not full_path.exists():
        return []

    sections = []
    with open(full_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip().startswith("## "):
                section = line.strip()[3:]
                sections.append(section)
    return sections


def extract_html_h3(html_path):
    """HTMLファイルから <h3>見出し</h3> を抽出"""
    full_path = BASE_DIR / html_path
    if not full_path.exists():
        return []

    with open(full_path, "r", encoding="utf-8") as f:
        content = f.read()

    # <h3>...</h3> を抽出（タグ内のテキストのみ）
    h3_pattern = re.compile(r"<h3[^>]*>(.*?)</h3>", re.DOTALL)
    matches = h3_pattern.findall(content)

    # HTMLタグを除去してテキストのみ取得
    h3s = []
    for m in matches:
        text = re.sub(r"<[^>]+>", "", m).strip()
        h3s.append(text)

    return h3s


def find_mismatches(qa_sections, html_h3s):
    """QAセクションとHTML h3の不一致を検出"""
    mismatches = []

    for qa_sec in qa_sections:
        # 完全一致または部分一致をチェック
        found = False
        for h3 in html_h3s:
            if qa_sec == h3 or qa_sec in h3 or h3 in qa_sec:
                found = True
                break

        if not found:
            # 最も類似したh3を探す
            best_match = None
            best_score = 0
            for h3 in html_h3s:
                # 共通文字数でスコア計算
                common = len(set(qa_sec) & set(h3))
                if common > best_score:
                    best_score = common
                    best_match = h3

            mismatches.append({
                "qa_section": qa_sec,
                "suggestion": best_match,
                "in_html": False
            })

    return mismatches


def fix_qa_file(qa_path, replacements):
    """QAファイルのセクション名を置換"""
    full_path = BASE_DIR / qa_path

    with open(full_path, "r", encoding="utf-8") as f:
        content = f.read()

    for old, new in replacements.items():
        if new:  # 置換先がある場合のみ
            content = content.replace(f"## {old}", f"## {new}")

    with open(full_path, "w", encoding="utf-8") as f:
        f.write(content)


def main():
    parser = argparse.ArgumentParser(description="QAセクション名とHTML h3の不一致を検出・修正")
    parser.add_argument("--fix", action="store_true", help="自動修正を実行")
    args = parser.parse_args()

    print("=" * 60)
    print("QAセクション ↔ HTML h3 不一致レポート")
    print("=" * 60)

    mapping = parse_data_js()

    total_mismatches = 0
    files_with_issues = 0
    all_fixes = {}  # {qa_path: {old: new, ...}}

    # HTMLにh3がないセクション（無視リスト）
    ignore_sections = {"国試頻出まとめ", "まとめ"}

    for qa_path, html_path in sorted(mapping.items()):
        qa_sections = extract_qa_sections(qa_path)
        html_h3s = extract_html_h3(html_path)

        if not qa_sections or not html_h3s:
            continue

        mismatches = find_mismatches(qa_sections, html_h3s)

        # 無視リストを除外
        mismatches = [m for m in mismatches if m["qa_section"] not in ignore_sections]

        if mismatches:
            files_with_issues += 1
            print(f"\n📁 {qa_path}")
            print(f"   HTML: {html_path}")

            fixes = {}
            for m in mismatches:
                total_mismatches += 1
                qa_sec = m["qa_section"]
                suggestion = m["suggestion"]

                print(f"   ❌ QA: '{qa_sec}'")
                if suggestion:
                    print(f"      → 候補: '{suggestion}'")
                    fixes[qa_sec] = suggestion
                else:
                    print(f"      → 候補なし（HTMLに該当h3なし）")

            if fixes:
                all_fixes[qa_path] = fixes

    print("\n" + "=" * 60)
    print(f"合計: {files_with_issues}ファイル、{total_mismatches}件の不一致")
    print("=" * 60)

    if args.fix and all_fixes:
        print("\n🔧 修正を実行中...")
        for qa_path, fixes in all_fixes.items():
            fix_qa_file(qa_path, fixes)
            print(f"   ✅ {qa_path}")
        print(f"\n修正完了: {len(all_fixes)}ファイル")
    elif all_fixes:
        print("\n💡 修正するには: python fix_qa_sections.py --fix")


if __name__ == "__main__":
    main()
