#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
インデックス生成スクリプト
HTML/Q&Aファイルをスキャンしてマッピングを構築
GitHub Pages用にファイルをコピー
"""

import os
import re
import json
import shutil
from pathlib import Path
from html.parser import HTMLParser

BASE_DIR = Path(__file__).parent.parent.parent
HTML_DIR = BASE_DIR / "出力したPDF"
QA_DIR = BASE_DIR / "Q&A"
APP_DIR = Path(__file__).parent.parent
OUTPUT_FILE = APP_DIR / "js" / "data.js"

# GitHub Pages用のコピー先
DEST_HTML_DIR = APP_DIR / "html"
DEST_QA_DIR = APP_DIR / "qa"


class HTMLTextExtractor(HTMLParser):
    """HTMLからテキストを抽出"""
    def __init__(self):
        super().__init__()
        self.text = []
        self.skip_tags = {'script', 'style', 'head'}
        self.current_tag = None

    def handle_starttag(self, tag, attrs):
        self.current_tag = tag

    def handle_endtag(self, tag):
        self.current_tag = None

    def handle_data(self, data):
        if self.current_tag not in self.skip_tags:
            self.text.append(data.strip())

    def get_text(self):
        return ' '.join(filter(None, self.text))


def extract_html_text(filepath):
    """HTMLファイルからテキストを抽出"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        parser = HTMLTextExtractor()
        parser.feed(content)
        return parser.get_text()[:2000]
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return ""


def normalize_name(filename):
    """ファイル名を正規化してマッチング用のキーを生成"""
    name = Path(filename).stem
    patterns = [
        r'_国試対策まとめ$',
        r'_国試分析.*$',
        r'_QA$',
        r'_v\d+$',
        r' \d+$',
    ]
    for pattern in patterns:
        name = re.sub(pattern, '', name)
    name = re.sub(r'^[ア-ン]_', '', name)
    name = re.sub(r'^[A-Z]_', '', name)
    return name


def safe_filename(filename):
    """ファイル名を安全な形式に変換"""
    name = filename.replace(' ', '_')
    return name


def find_html_files():
    """HTMLファイルを再帰的に検索"""
    html_files = {}
    for root, dirs, files in os.walk(HTML_DIR):
        for file in files:
            if file.endswith('.html') and not file.startswith('.'):
                filepath = Path(root) / file
                key = normalize_name(file)
                rel_path = filepath.relative_to(BASE_DIR)
                parts = rel_path.parts
                if len(parts) > 2:
                    category = '/'.join(parts[1:-1])
                else:
                    category = "その他"
                html_files[key] = {
                    'path': str(rel_path),
                    'filename': file,
                    'category': category,
                    'fullpath': filepath
                }
    return html_files


def find_qa_files():
    """Q&Aファイルを検索"""
    qa_files = {}
    for file in QA_DIR.iterdir():
        if file.suffix == '.txt' and file.name.endswith('_QA.txt'):
            key = normalize_name(file.name)
            rel_path = file.relative_to(BASE_DIR)
            qa_files[key] = {
                'path': str(rel_path),
                'filename': file.name,
                'fullpath': file
            }
    return qa_files


def read_qa_content(filepath):
    """Q&Aファイルの内容を読み込み"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()[:3000]
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return ""


def copy_files(html_files, qa_files):
    """ファイルをコピー"""
    # ディレクトリをクリア
    if DEST_HTML_DIR.exists():
        shutil.rmtree(DEST_HTML_DIR)
    if DEST_QA_DIR.exists():
        shutil.rmtree(DEST_QA_DIR)

    DEST_HTML_DIR.mkdir(parents=True, exist_ok=True)
    DEST_QA_DIR.mkdir(parents=True, exist_ok=True)

    # HTMLをコピー
    html_mapping = {}
    for key, info in html_files.items():
        dest_name = safe_filename(info['filename'])
        dest_path = DEST_HTML_DIR / dest_name
        shutil.copy2(info['fullpath'], dest_path)
        html_mapping[key] = f"html/{dest_name}"

    # Q&Aをコピー
    qa_mapping = {}
    for key, info in qa_files.items():
        dest_name = safe_filename(info['filename'])
        dest_path = DEST_QA_DIR / dest_name
        shutil.copy2(info['fullpath'], dest_path)
        qa_mapping[key] = f"qa/{dest_name}"

    return html_mapping, qa_mapping


def build_index(html_files, qa_files, html_mapping, qa_mapping):
    """インデックスを構築"""
    items = []
    matched_qa = set()

    for key, html_info in html_files.items():
        qa_info = qa_files.get(key)

        item = {
            'id': key.lower().replace(' ', '-'),
            'title': Path(html_info['filename']).stem.replace('_国試対策まとめ', '').replace('_国試分析', ''),
            'category': html_info['category'],
            'htmlPath': html_mapping.get(key),
            'qaPath': qa_mapping.get(key) if qa_info else None,
            'searchText': ''
        }

        html_text = extract_html_text(html_info['fullpath'])
        item['searchText'] = item['title'] + ' ' + html_text

        if qa_info:
            qa_content = read_qa_content(qa_info['fullpath'])
            item['searchText'] += ' ' + qa_content
            matched_qa.add(key)

        items.append(item)

    for key, qa_info in qa_files.items():
        if key not in matched_qa:
            qa_content = read_qa_content(qa_info['fullpath'])
            items.append({
                'id': key.lower().replace(' ', '-'),
                'title': Path(qa_info['filename']).stem.replace('_QA', ''),
                'category': 'Q&Aのみ',
                'htmlPath': None,
                'qaPath': qa_mapping.get(key),
                'searchText': key + ' ' + qa_content
            })

    items.sort(key=lambda x: (x['category'], x['title']))
    return items


def main():
    print("Building index for GitHub Pages...")

    html_files = find_html_files()
    qa_files = find_qa_files()

    print(f"Found {len(html_files)} HTML files")
    print(f"Found {len(qa_files)} Q&A files")

    print("Copying files...")
    html_mapping, qa_mapping = copy_files(html_files, qa_files)

    print("Building index...")
    items = build_index(html_files, qa_files, html_mapping, qa_mapping)

    js_content = f"// Auto-generated by build_index.py\nconst DATA = {json.dumps(items, ensure_ascii=False, indent=2)};\n"

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        f.write(js_content)

    print(f"Generated {OUTPUT_FILE}")
    print(f"Total items: {len(items)}")

    with_both = sum(1 for i in items if i['htmlPath'] and i['qaPath'])
    html_only = sum(1 for i in items if i['htmlPath'] and not i['qaPath'])
    qa_only = sum(1 for i in items if not i['htmlPath'] and i['qaPath'])
    print(f"  HTML + Q&A: {with_both}")
    print(f"  HTML only: {html_only}")
    print(f"  Q&A only: {qa_only}")
    print(f"\nFiles copied to:")
    print(f"  HTML: {DEST_HTML_DIR}")
    print(f"  Q&A: {DEST_QA_DIR}")


if __name__ == '__main__':
    main()
