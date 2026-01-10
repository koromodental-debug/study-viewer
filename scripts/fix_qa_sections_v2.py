#!/usr/bin/env python3
"""
QAセクション名をHTMLのh3に合わせて修正（改良版）

使い方:
  python fix_qa_sections_v2.py              # レポートのみ
  python fix_qa_sections_v2.py --fix        # 高確度のみ自動修正
  python fix_qa_sections_v2.py --fix --all  # 中確度も含めて修正
"""

import os
import re
import json
import argparse
from pathlib import Path
from difflib import SequenceMatcher

BASE_DIR = Path(__file__).parent.parent
DATA_JS = BASE_DIR / "js" / "data.js"
QA_DIR = BASE_DIR / "qa"
HTML_DIR = BASE_DIR / "html"


def parse_data_js():
    """data.jsからqaPath→htmlPathのマッピングを取得"""
    with open(DATA_JS, "r", encoding="utf-8") as f:
        content = f.read()
    match = re.search(r"const DATA = (\[[\s\S]*\]);?", content)
    if not match:
        raise ValueError("data.jsのパースに失敗")
    data = json.loads(match.group(1))
    return {item["qaPath"]: item["htmlPath"] for item in data if item.get("qaPath") and item.get("htmlPath")}


def extract_qa_sections(qa_path):
    """QAファイルから ## セクション名 を抽出"""
    full_path = BASE_DIR / qa_path
    if not full_path.exists():
        return []
    sections = []
    with open(full_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip().startswith("## "):
                sections.append(line.strip()[3:])
    return sections


def extract_html_h3(html_path):
    """HTMLファイルから h3 を抽出"""
    full_path = BASE_DIR / html_path
    if not full_path.exists():
        return []
    with open(full_path, "r", encoding="utf-8") as f:
        content = f.read()
    h3_pattern = re.compile(r"<h3[^>]*>(.*?)</h3>", re.DOTALL)
    matches = h3_pattern.findall(content)
    return [re.sub(r"<[^>]+>", "", m).strip() for m in matches]


def normalize(text):
    """正規化: 比較用に文字列を簡略化"""
    t = text
    # 全角→半角
    t = t.replace("（", "(").replace("）", ")").replace("：", ":").replace("　", " ")
    # 助詞・接続詞を除去
    t = re.sub(r"[はがのをでにへと]", "", t)
    # 空白除去
    t = re.sub(r"\s+", "", t)
    # 小文字化
    t = t.lower()
    return t


def swap_paren_order(text):
    """「A（B）」→「B（A）」の変換を試す"""
    match = re.match(r"^(.+?)[（(](.+?)[）)]$", text)
    if match:
        return f"{match.group(2)}（{match.group(1)}）"
    return None


def calc_similarity(a, b):
    """類似度スコア（0〜1）"""
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


def find_best_match(qa_sec, html_h3s):
    """
    QAセクションに対する最適なHTMLのh3を探す
    Returns: (matched_h3, confidence, reason)
    confidence: 'high', 'medium', 'low', 'none'
    """
    qa_norm = normalize(qa_sec)

    # 1. 完全一致
    for h3 in html_h3s:
        if qa_sec == h3:
            return h3, "exact", "完全一致"

    # 2. 正規化後一致
    for h3 in html_h3s:
        if qa_norm == normalize(h3):
            return h3, "high", "正規化一致"

    # 3. 片方が片方を含む（正規化後）
    for h3 in html_h3s:
        h3_norm = normalize(h3)
        if qa_norm in h3_norm or h3_norm in qa_norm:
            # 長さの差が小さいほど信頼度が高い
            len_ratio = min(len(qa_norm), len(h3_norm)) / max(len(qa_norm), len(h3_norm))
            if len_ratio > 0.5:
                return h3, "high", "部分一致"
            else:
                return h3, "medium", "部分一致（長さ差大）"

    # 4. 括弧内外の入れ替え
    swapped = swap_paren_order(qa_sec)
    if swapped:
        for h3 in html_h3s:
            if normalize(swapped) == normalize(h3):
                return h3, "high", "括弧順入替"
            if normalize(swapped) in normalize(h3) or normalize(h3) in normalize(swapped):
                return h3, "medium", "括弧順入替+部分一致"

    # 5. 類似度ベース
    best_h3 = None
    best_score = 0
    for h3 in html_h3s:
        score = calc_similarity(qa_sec, h3)
        if score > best_score:
            best_score = score
            best_h3 = h3

    if best_score >= 0.7:
        return best_h3, "medium", f"類似度{best_score:.0%}"
    elif best_score >= 0.5:
        return best_h3, "low", f"類似度{best_score:.0%}"

    return None, "none", "マッチなし"


def fix_qa_file(qa_path, replacements):
    """QAファイルのセクション名を置換"""
    full_path = BASE_DIR / qa_path
    with open(full_path, "r", encoding="utf-8") as f:
        content = f.read()

    for old, new in replacements.items():
        content = content.replace(f"## {old}\n", f"## {new}\n")

    with open(full_path, "w", encoding="utf-8") as f:
        f.write(content)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fix", action="store_true", help="高確度のみ自動修正")
    parser.add_argument("--all", action="store_true", help="中確度も含めて修正")
    args = parser.parse_args()

    # 無視するセクション
    IGNORE = {"国試頻出まとめ", "まとめ", "頻出まとめ"}

    mapping = parse_data_js()

    stats = {"exact": 0, "high": 0, "medium": 0, "low": 0, "none": 0}
    fixes_high = {}  # {qa_path: {old: new}}
    fixes_medium = {}
    review_list = []

    print("=" * 70)
    print("QAセクション ↔ HTML h3 マッチング解析（改良版）")
    print("=" * 70)

    for qa_path, html_path in sorted(mapping.items()):
        qa_sections = extract_qa_sections(qa_path)
        html_h3s = extract_html_h3(html_path)

        if not qa_sections or not html_h3s:
            continue

        file_issues = []
        for qa_sec in qa_sections:
            if qa_sec in IGNORE:
                continue

            # 既にマッチするか簡易チェック
            quick_match = any(
                qa_sec == h3 or qa_sec in h3 or h3 in qa_sec
                for h3 in html_h3s
            )
            if quick_match:
                stats["exact"] += 1
                continue

            matched_h3, confidence, reason = find_best_match(qa_sec, html_h3s)
            stats[confidence] += 1

            if confidence in ("high", "medium", "low"):
                file_issues.append((qa_sec, matched_h3, confidence, reason))

                if confidence == "high":
                    fixes_high.setdefault(qa_path, {})[qa_sec] = matched_h3
                elif confidence == "medium":
                    fixes_medium.setdefault(qa_path, {})[qa_sec] = matched_h3

            if confidence in ("low", "none"):
                review_list.append({
                    "qa_path": qa_path,
                    "qa_section": qa_sec,
                    "suggestion": matched_h3,
                    "reason": reason
                })

        if file_issues:
            print(f"\n📁 {qa_path}")
            for qa_sec, matched_h3, conf, reason in file_issues:
                icon = {"high": "🟢", "medium": "🟡", "low": "🔴"}[conf]
                print(f"   {icon} [{conf}] '{qa_sec}'")
                print(f"      → '{matched_h3}' ({reason})")

    print("\n" + "=" * 70)
    print("統計:")
    print(f"  ✅ 既にマッチ: {stats['exact']}")
    print(f"  🟢 高確度修正可能: {stats['high']}")
    print(f"  🟡 中確度修正可能: {stats['medium']}")
    print(f"  🔴 低確度（要確認）: {stats['low']}")
    print(f"  ❌ マッチなし: {stats['none']}")
    print("=" * 70)

    # 修正実行
    if args.fix:
        to_fix = fixes_high.copy()
        if args.all:
            for path, fixes in fixes_medium.items():
                to_fix.setdefault(path, {}).update(fixes)

        if to_fix:
            print(f"\n🔧 修正実行中... ({len(to_fix)}ファイル)")
            for qa_path, fixes in to_fix.items():
                fix_qa_file(qa_path, fixes)
                print(f"   ✅ {qa_path} ({len(fixes)}件)")

            total_fixes = sum(len(f) for f in to_fix.values())
            print(f"\n修正完了: {total_fixes}件")
        else:
            print("\n修正対象がありません")
    else:
        total_fixable = stats['high'] + (stats['medium'] if args.all else 0)
        print(f"\n💡 修正するには:")
        print(f"   python fix_qa_sections_v2.py --fix       # 高確度のみ({stats['high']}件)")
        print(f"   python fix_qa_sections_v2.py --fix --all # 中確度含む({stats['high'] + stats['medium']}件)")

    # レビュー用ファイル出力
    if review_list:
        review_path = BASE_DIR / "scripts" / "review_sections.txt"
        with open(review_path, "w", encoding="utf-8") as f:
            f.write("# 要確認セクション一覧\n")
            f.write("# 手動で確認して修正が必要なもの\n\n")
            for item in review_list:
                f.write(f"ファイル: {item['qa_path']}\n")
                f.write(f"  QA: {item['qa_section']}\n")
                f.write(f"  候補: {item['suggestion'] or '(なし)'}\n")
                f.write(f"  理由: {item['reason']}\n\n")
        print(f"\n📝 要確認リスト: scripts/review_sections.txt")


if __name__ == "__main__":
    main()
