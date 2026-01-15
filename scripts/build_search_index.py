#!/usr/bin/env python3
"""
検索インデックスJSONを生成するスクリプト
全QAファイルを読み込んで search-index.json を出力
"""

import json
import os
import re
from pathlib import Path

# study-viewerディレクトリのパス
STUDY_VIEWER_DIR = Path(__file__).parent.parent
DATA_JS_PATH = STUDY_VIEWER_DIR / "js" / "data.js"
OUTPUT_PATH = STUDY_VIEWER_DIR / "search-index.json"


def parse_data_js():
    """data.jsからDATAオブジェクトを抽出"""
    with open(DATA_JS_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    # const DATA = [...] を抽出
    match = re.search(r'const\s+DATA\s*=\s*(\[[\s\S]*?\]);', content)
    if not match:
        raise ValueError("DATA not found in data.js")

    data_str = match.group(1)
    return json.loads(data_str)


def parse_qa_file(file_path, topic_id):
    """QAファイルをパースしてカードリストを返す"""
    cards = []

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        return cards

    lines = content.split("\n")
    current_section = ""
    current_q = None
    index = 0

    for line in lines:
        trimmed = line.strip()

        if trimmed.startswith("## "):
            current_section = trimmed[3:]
        elif trimmed.startswith("Q: ") or trimmed.startswith("Q:"):
            current_q = re.sub(r'^Q:\s*', '', trimmed)
        elif (trimmed.startswith("A: ") or trimmed.startswith("A:")) and current_q:
            answer = re.sub(r'^A:\s*', '', trimmed)
            cards.append({
                "originalIndex": index,
                "section": current_section,
                "question": current_q,
                "answer": answer,
                "topicId": topic_id
            })
            index += 1
            current_q = None

    return cards


def build_search_index():
    """検索インデックスを構築"""
    data = parse_data_js()
    all_items = []

    for topic in data:
        qa_path = topic.get("qaPath")
        if not qa_path:
            continue

        topic_id = topic.get("id", "")
        title = topic.get("title", "")
        subject = topic.get("subject", "その他")

        # タイトルからプレフィックスを除去
        topic_title = re.sub(r'^[ア-オ]_', '', title)

        # QAファイルのフルパス
        qa_full_path = STUDY_VIEWER_DIR / qa_path

        # カードをパース
        cards = parse_qa_file(qa_full_path, topic_id)

        # 検索用データに変換
        for card in cards:
            all_items.append({
                "type": "card",
                "question": card["question"],
                "answer": card["answer"],
                "topicId": topic_id,
                "topicTitle": topic_title,
                "subject": subject,
                "originalIndex": card["originalIndex"],
                "searchKey": f"{topic_id}:{card['originalIndex']}"
            })

    # まとめ（QAがないがsearchTextがあるトピック）も追加
    for topic in data:
        if topic.get("qaPath"):
            continue

        search_text = topic.get("searchText", "")
        if not search_text:
            continue

        topic_id = topic.get("id", "")
        title = topic.get("title", "")
        subject = topic.get("subject", "その他")
        topic_title = re.sub(r'^[ア-オ]_', '', title)

        all_items.append({
            "type": "summary",
            "topicId": topic_id,
            "topicTitle": topic_title,
            "subject": subject,
            "searchText": search_text,
            "searchKey": f"summary:{topic_id}"
        })

    return all_items


def main():
    print("検索インデックスを構築中...")

    items = build_search_index()

    # JSON出力
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, separators=(',', ':'))

    # 統計
    cards = [i for i in items if i["type"] == "card"]
    summaries = [i for i in items if i["type"] == "summary"]

    file_size = os.path.getsize(OUTPUT_PATH) / 1024

    print(f"完了: {len(cards)}カード + {len(summaries)}まとめ")
    print(f"出力: {OUTPUT_PATH} ({file_size:.1f} KB)")


if __name__ == "__main__":
    main()
