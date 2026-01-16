#!/usr/bin/env python3
"""
HTMLファイルから全文検索用インデックスを生成するスクリプト
- html/subject/内のHTMLファイルからテキストを抽出
- fulltext-index.jsonに出力
"""
import os
import re
import json
import html

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
HTML_SUBJECT_DIR = os.path.join(BASE_DIR, "html/subject")
OUTPUT_PATH = os.path.join(BASE_DIR, "fulltext-index.json")


def extract_text_from_html(html_path):
    """HTMLファイルからテキストを抽出"""
    try:
        with open(html_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return ""

    # scriptとstyleタグを除去
    content = re.sub(r'<script[^>]*>.*?</script>', '', content, flags=re.DOTALL | re.IGNORECASE)
    content = re.sub(r'<style[^>]*>.*?</style>', '', content, flags=re.DOTALL | re.IGNORECASE)

    # HTMLタグを除去
    content = re.sub(r'<[^>]+>', ' ', content)

    # HTMLエンティティをデコード
    content = html.unescape(content)

    # 連続する空白を1つに
    content = re.sub(r'\s+', ' ', content)

    # 前後の空白を除去
    content = content.strip()

    return content


def get_topic_id_from_path(html_path):
    """HTMLパスからトピックIDを生成"""
    # html/subject/科目/ファイル名.html -> ファイル名（拡張子なし）のタイトル部分
    filename = os.path.basename(html_path)
    base_name = filename.replace('.html', '')
    # 01_タイトル -> タイトル
    if '_' in base_name:
        return base_name.split('_', 1)[-1]
    return base_name


def main():
    index = {}

    # html/subject/内のHTMLファイルをスキャン
    for subject_dir in sorted(os.listdir(HTML_SUBJECT_DIR)):
        subject_path = os.path.join(HTML_SUBJECT_DIR, subject_dir)
        if not os.path.isdir(subject_path):
            continue

        for html_file in sorted(os.listdir(subject_path)):
            if not html_file.endswith('.html'):
                continue

            html_path = os.path.join(subject_path, html_file)
            html_rel_path = f"html/subject/{subject_dir}/{html_file}"

            # テキストを抽出
            text = extract_text_from_html(html_path)

            if text:
                # htmlPathをキーにする（data.jsと一致させる）
                index[html_rel_path] = text

    # JSON出力
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False)

    # 統計情報
    total_size = os.path.getsize(OUTPUT_PATH)
    print(f"全文インデックスを生成しました")
    print(f"  トピック数: {len(index)}")
    print(f"  ファイルサイズ: {total_size / 1024:.1f} KB")
    print(f"  出力: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
