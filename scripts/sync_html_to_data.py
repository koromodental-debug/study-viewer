#!/usr/bin/env python3
"""
html/subject/内のHTMLファイルをdata.jsに自動同期するスクリプト
- 新しいHTMLファイルを自動追加
- 既存エントリにhtmlPathを追加
- HTMLからキーワードを抽出してsearchTextを自動生成
- pre-commitフックから呼び出される
"""
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
DATA_JS_PATH = os.path.join(BASE_DIR, "js/data.js")
HTML_SUBJECT_DIR = os.path.join(BASE_DIR, "html/subject")


def extract_search_text(html_full_path):
    """HTMLファイルからキーワードを抽出してsearchText用の文字列を生成"""
    try:
        with open(html_full_path, 'r', encoding='utf-8') as f:
            html_content = f.read()
    except Exception:
        return ""

    keywords = set()

    def add_keyword(text):
        """キーワードを追加（フィルタリング付き）"""
        text = text.strip()
        # 長さチェック（2-50文字）
        if not text or len(text) < 2 or len(text) > 50:
            return
        # 数字のみは除外
        if text.isdigit():
            return
        # JSONで問題になる文字を含むものは除外
        if any(c in text for c in '{}[]"\'\\'):
            return
        # 改行を含むものは除外
        if '\n' in text or '\r' in text:
            return
        keywords.add(text)

    # h1, h2, h3タグのテキストを抽出（見出し）
    for tag in ['h1', 'h2', 'h3']:
        heading_pattern = rf'<{tag}[^>]*>([^<]+)</{tag}>'
        for match in re.finditer(heading_pattern, html_content, re.IGNORECASE):
            add_keyword(match.group(1))

    # class="key"のテキストを抽出（重要キーワード）
    key_pattern = r'<span[^>]*class="[^"]*key[^"]*"[^>]*>([^<]+)</span>'
    for match in re.finditer(key_pattern, html_content, re.IGNORECASE):
        add_keyword(match.group(1))

    # class="highlight"のテキストを抽出
    highlight_pattern = r'<span[^>]*class="[^"]*highlight[^"]*"[^>]*>([^<]+)</span>'
    for match in re.finditer(highlight_pattern, html_content, re.IGNORECASE):
        add_keyword(match.group(1))

    # point-box-titleのテキストを抽出
    point_pattern = r'<div[^>]*class="[^"]*point-box-title[^"]*"[^>]*>([^<]+)</div>'
    for match in re.finditer(point_pattern, html_content, re.IGNORECASE):
        add_keyword(match.group(1))

    return ' '.join(sorted(keywords))


def main():
    with open(DATA_JS_PATH, 'r', encoding='utf-8') as f:
        content = f.read()

    # 既存のhtmlPathとIDを収集
    existing_html_paths = set(re.findall(r'"htmlPath":\s*"([^"]+)"', content))
    existing_ids = set(re.findall(r'"id":\s*"([^"]+)"', content))

    # 既存のqaPathとそのエントリ位置を収集（htmlPathを追加するため）
    qa_to_entry = {}
    for match in re.finditer(r'"qaPath":\s*"(qa/subject/[^"]+)"', content):
        qa_path = match.group(1)
        qa_to_entry[qa_path] = match.start()

    changes_made = False
    new_entries = []
    updated_count = 0

    # html/subject/内のHTMLファイルをスキャン
    for subject_dir in sorted(os.listdir(HTML_SUBJECT_DIR)):
        subject_path = os.path.join(HTML_SUBJECT_DIR, subject_dir)
        if not os.path.isdir(subject_path):
            continue

        for html_file in sorted(os.listdir(subject_path)):
            if not html_file.endswith('.html'):
                continue

            html_path = f"html/subject/{subject_dir}/{html_file}"
            html_full_path = os.path.join(BASE_DIR, html_path)

            # 対応するQAファイルパスを生成
            base_name = html_file.replace('.html', '')
            qa_path = f"qa/subject/{subject_dir}/{base_name}_QA.txt"

            if html_path not in existing_html_paths:
                # 新規HTMLファイル
                if qa_path in qa_to_entry:
                    # 既存エントリにhtmlPathを追加
                    pattern = re.escape(f'"qaPath": "{qa_path}"') + r',\s*"htmlPath":\s*null'
                    replacement = f'"qaPath": "{qa_path}",\n    "htmlPath": "{html_path}"'
                    new_content, count = re.subn(pattern, replacement, content)
                    if count > 0:
                        content = new_content
                        updated_count += 1
                        changes_made = True
                else:
                    # 新規エントリを作成
                    title = base_name.split('_', 1)[-1] if '_' in base_name else base_name

                    # IDが既に存在する場合はスキップ
                    if title in existing_ids:
                        continue

                    # 「〇〇学」→「〇〇」に変換（ただし結果が1文字になる場合は変換しない）
                    if subject_dir.endswith('学') and len(subject_dir) > 2:
                        subject = subject_dir[:-1]
                    else:
                        subject = subject_dir
                    # HTMLからキーワードを抽出
                    extracted_keywords = extract_search_text(html_full_path)
                    search_text = f"{title} {extracted_keywords}".strip()

                    entry = f'''  {{
    "id": "{title}",
    "title": "{title}",
    "qaPath": null,
    "htmlPath": "{html_path}",
    "subject": "{subject}",
    "subjectCategory": "基礎",
    "searchText": "{search_text}"
  }}'''
                    new_entries.append(entry)
            # 既存エントリのsearchText更新は不要
            # 全文検索はfulltext-index.jsonで行う

    # 新規エントリを追加
    if new_entries:
        insert_pos = content.rfind('];')
        if insert_pos == -1:
            print("ERROR: DATA配列の末尾が見つかりません", file=sys.stderr)
            return 1

        before_bracket = content[:insert_pos].rstrip()
        if not before_bracket.endswith(','):
            before_bracket += ','

        content = before_bracket + '\n' + ',\n'.join(new_entries) + '\n];'
        changes_made = True

    if changes_made:
        with open(DATA_JS_PATH, 'w', encoding='utf-8') as f:
            f.write(content)

        if updated_count > 0:
            print(f"既存エントリに{updated_count}件のhtmlPathを追加しました")
        if new_entries:
            print(f"data.jsに{len(new_entries)}件のHTMLを追加しました:")
            for entry in new_entries[:5]:
                match = re.search(r'"htmlPath": "([^"]+)"', entry)
                if match:
                    print(f"  + {match.group(1)}")
            if len(new_entries) > 5:
                print(f"  ... 他{len(new_entries)-5}件")
        return 2  # 変更あり

    return 0  # 変更なし

if __name__ == "__main__":
    sys.exit(main())
