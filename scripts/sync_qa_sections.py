#!/usr/bin/env python3
"""
QAセクション名をHTMLの見出しと完全同期するスクリプト

類似度ベースでマッチングし、HTMLの見出しテキストに置換する。
これにより、フラッシュカードのまとめ表示が正しく機能する。

使い方:
  python sync_qa_sections.py              # レポートのみ（dry-run）
  python sync_qa_sections.py --apply      # 実際に適用
  python sync_qa_sections.py --verbose    # 詳細表示
"""

import os
import re
import json
import argparse
from pathlib import Path
from difflib import SequenceMatcher

BASE_DIR = Path(__file__).parent.parent
DATA_JS = BASE_DIR / "js" / "data.js"


def parse_data_js():
    """data.jsからqaPath→htmlPathのマッピングを取得"""
    with open(DATA_JS, "r", encoding="utf-8") as f:
        content = f.read()
    match = re.search(r"const DATA = (\[[\s\S]*\]);?", content)
    if not match:
        raise ValueError("data.jsのパースに失敗")
    data = json.loads(match.group(1))
    return {item["qaPath"]: item["htmlPath"] for item in data if item.get("qaPath") and item.get("htmlPath")}


def normalize(text):
    """正規化：比較用に文字列を簡略化"""
    t = text
    t = t.replace("（", "(").replace("）", ")").replace("：", ":").replace("　", " ")
    t = re.sub(r"[はがのをでにへと]", "", t)
    t = re.sub(r"\s+", "", t)
    t = t.lower()
    return t


def calc_similarity(a, b):
    """類似度スコア（0〜1）"""
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


def extract_html_headings(html_path):
    """HTMLから見出しを抽出（h3優先、なければh2）"""
    full_path = BASE_DIR / html_path
    if not full_path.exists():
        return [], "not_found"

    with open(full_path, "r", encoding="utf-8") as f:
        content = f.read()

    # h3を抽出
    h3_pattern = re.compile(r"<h3[^>]*>(.*?)</h3>", re.DOTALL)
    h3_matches = h3_pattern.findall(content)
    if h3_matches:
        headings = [re.sub(r"<[^>]+>", "", m).strip() for m in h3_matches]
        return headings, "h3"

    # h3がなければh2を抽出
    h2_pattern = re.compile(r"<h2[^>]*>(.*?)</h2>", re.DOTALL)
    h2_matches = h2_pattern.findall(content)
    if h2_matches:
        headings = [re.sub(r"<[^>]+>", "", m).strip() for m in h2_matches]
        return headings, "h2"

    return [], "no_headings"


def extract_qa_sections(qa_path):
    """QAファイルから##セクションを抽出（行番号付き）"""
    full_path = BASE_DIR / qa_path
    if not full_path.exists():
        return [], "not_found"

    sections = []
    with open(full_path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            if line.strip().startswith("## "):
                section_name = line.strip()[3:]
                sections.append({"name": section_name, "line": i, "original": line})

    return sections, "ok"


def find_best_match(qa_section, html_headings, used_indices):
    """QAセクションに最適なHTML見出しを探す（使用済みを除外）"""
    qa_norm = normalize(qa_section)

    best_match = None
    best_score = 0
    best_idx = -1

    for i, h in enumerate(html_headings):
        if i in used_indices:
            continue

        h_norm = normalize(h)

        # 完全一致
        if qa_section == h:
            return h, 1.0, i, "exact"

        # 正規化一致
        if qa_norm == h_norm:
            return h, 0.95, i, "normalized"

        # 部分一致
        if qa_norm in h_norm or h_norm in qa_norm:
            len_ratio = min(len(qa_norm), len(h_norm)) / max(len(qa_norm), len(h_norm))
            score = 0.8 + (0.1 * len_ratio)
            if score > best_score:
                best_score = score
                best_match = h
                best_idx = i

        # 類似度
        sim = calc_similarity(qa_section, h)
        if sim > best_score:
            best_score = sim
            best_match = h
            best_idx = i

    if best_score >= 0.5:
        reason = f"similarity {best_score:.0%}"
        return best_match, best_score, best_idx, reason

    return None, 0, -1, "no_match"


def sync_qa_file(qa_path, html_headings, dry_run=True, verbose=False):
    """QAファイルのセクション名をHTML見出しに同期（類似度ベース）"""
    full_path = BASE_DIR / qa_path

    with open(full_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    qa_sections, _ = extract_qa_sections(qa_path)

    # 無視するセクション
    IGNORE_SECTIONS = {"国試頻出まとめ", "まとめ", "頻出まとめ", "国試頻出"}

    changes = []
    used_indices = set()

    for qa_sec in qa_sections:
        if qa_sec["name"] in IGNORE_SECTIONS:
            continue

        # 既にHTML見出しと一致している場合はスキップ
        if qa_sec["name"] in html_headings:
            idx = html_headings.index(qa_sec["name"])
            used_indices.add(idx)
            continue

        # 最適なマッチを探す
        match, score, idx, reason = find_best_match(qa_sec["name"], html_headings, used_indices)

        if match and score >= 0.5:
            used_indices.add(idx)
            changes.append({
                "line": qa_sec["line"],
                "old": qa_sec["name"],
                "new": match,
                "score": score,
                "reason": reason
            })
            # 行を置換
            line_idx = qa_sec["line"] - 1
            lines[line_idx] = f"## {match}\n"

    if not dry_run and changes:
        with open(full_path, "w", encoding="utf-8") as f:
            f.writelines(lines)

    return changes


def main():
    parser = argparse.ArgumentParser(description="QAセクション名をHTML見出しと同期")
    parser.add_argument("--apply", action="store_true", help="実際に変更を適用")
    parser.add_argument("--verbose", "-v", action="store_true", help="詳細表示")
    parser.add_argument("--threshold", type=float, default=0.5, help="マッチング閾値（デフォルト0.5）")
    args = parser.parse_args()

    dry_run = not args.apply

    print("=" * 70)
    print("QAセクション ↔ HTML見出し 同期スクリプト（類似度ベース）")
    print("=" * 70)
    if dry_run:
        print("モード: ドライラン（変更なし）")
    else:
        print("モード: 適用（ファイルを変更）")
    print()

    mapping = parse_data_js()

    stats = {
        "synced": 0,
        "already_ok": 0,
        "no_html_headings": 0,
        "html_not_found": 0,
        "qa_not_found": 0,
    }

    all_changes = []
    no_match_list = []

    for qa_path, html_path in sorted(mapping.items()):
        html_headings, html_status = extract_html_headings(html_path)
        qa_sections, qa_status = extract_qa_sections(qa_path)

        if html_status == "not_found":
            stats["html_not_found"] += 1
            continue
        if qa_status == "not_found":
            stats["qa_not_found"] += 1
            continue
        if html_status == "no_headings":
            stats["no_html_headings"] += 1
            if args.verbose:
                print(f"⚠️  見出しなし: {html_path}")
            continue
        if not qa_sections:
            continue

        changes = sync_qa_file(qa_path, html_headings, dry_run, args.verbose)

        if changes:
            stats["synced"] += 1
            all_changes.append({"path": qa_path, "changes": changes})

            if args.verbose:
                print(f"\n📁 {qa_path}")
                for c in changes:
                    score_str = f"{c['score']:.0%}" if c['score'] < 1 else "100%"
                    print(f"   🔄 '{c['old']}' → '{c['new']}' ({score_str})")
        else:
            stats["already_ok"] += 1

    # 結果サマリー
    print("\n" + "=" * 70)
    print("結果サマリー")
    print("=" * 70)
    print(f"  ✅ 同期対象: {stats['synced']}ファイル")
    print(f"  ✓  変更不要: {stats['already_ok']}ファイル")
    print(f"  ❌ 見出しなし: {stats['no_html_headings']}ファイル")

    total_changes = sum(len(c["changes"]) for c in all_changes)
    print(f"\n  変更箇所: {total_changes}件")

    if dry_run and total_changes > 0:
        print(f"\n💡 適用するには: python sync_qa_sections.py --apply")

    # 変更一覧ファイル出力
    if all_changes:
        changes_path = BASE_DIR / "scripts" / "sync_changes.txt"
        with open(changes_path, "w", encoding="utf-8") as f:
            f.write("# 同期変更一覧\n\n")
            for item in all_changes:
                f.write(f"## {item['path']}\n")
                for c in item["changes"]:
                    f.write(f"  - '{c['old']}' → '{c['new']}'\n")
                f.write("\n")
        print(f"\n📝 変更一覧: scripts/sync_changes.txt")


if __name__ == "__main__":
    main()
