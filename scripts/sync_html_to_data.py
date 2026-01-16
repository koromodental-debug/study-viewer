#!/usr/bin/env python3
"""
html/subject/内のHTMLファイルをdata.jsに自動同期するスクリプト
- 新しいHTMLファイルを自動追加
- 既存エントリにhtmlPathを追加
- pre-commitフックから呼び出される
"""
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
DATA_JS_PATH = os.path.join(BASE_DIR, "js/data.js")
HTML_SUBJECT_DIR = os.path.join(BASE_DIR, "html/subject")

def main():
    with open(DATA_JS_PATH, 'r') as f:
        content = f.read()

    # 既存のhtmlPathを収集
    existing_html_paths = set(re.findall(r'"htmlPath":\s*"([^"]+)"', content))

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
            if html_path in existing_html_paths:
                continue

            # 対応するQAファイルパスを生成
            base_name = html_file.replace('.html', '')
            qa_path = f"qa/subject/{subject_dir}/{base_name}_QA.txt"

            if qa_path in qa_to_entry:
                # 既存エントリにhtmlPathを追加
                # qaPathの直後にあるhtmlPath: nullを置換
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
                subject = subject_dir.replace('学', '')

                entry = f'''  {{
    "id": "{title}",
    "title": "{title}",
    "qaPath": null,
    "htmlPath": "{html_path}",
    "subject": "{subject}",
    "subjectCategory": "基礎"
  }}'''
                new_entries.append(entry)

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
        with open(DATA_JS_PATH, 'w') as f:
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
