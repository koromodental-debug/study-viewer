#!/usr/bin/env python3
"""
qa/subject/内のQAファイルをdata.jsに自動同期するスクリプト
- 新しいQAファイルを自動追加
- pre-commitフックから呼び出される
"""
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
DATA_JS_PATH = os.path.join(BASE_DIR, "js/data.js")
QA_SUBJECT_DIR = os.path.join(BASE_DIR, "qa/subject")

def main():
    with open(DATA_JS_PATH, 'r') as f:
        content = f.read()

    # 既存のqaPathとIDを収集
    existing_qa_paths = set(re.findall(r'"qaPath":\s*"([^"]+)"', content))
    existing_ids = set(re.findall(r'"id":\s*"([^"]+)"', content))

    # qa/subject/内のQAファイルをスキャン
    new_entries = []
    added_titles = set()  # このセッションで追加したタイトルを追跡

    for subject_dir in sorted(os.listdir(QA_SUBJECT_DIR)):
        subject_path = os.path.join(QA_SUBJECT_DIR, subject_dir)
        if not os.path.isdir(subject_path):
            continue

        # 各ディレクトリ内のファイルを収集
        qa_files = sorted(os.listdir(subject_path))

        for qa_file in qa_files:
            # .txt と .json の両方をサポート（.txtを優先）
            if qa_file.endswith('_QA.txt'):
                suffix = '_QA.txt'
            elif qa_file.endswith('_QA.json'):
                suffix = '_QA.json'
                # 対応する.txtファイルが存在する場合はスキップ
                txt_file = qa_file.replace('_QA.json', '_QA.txt')
                if txt_file in qa_files:
                    continue  # .txtを優先
            else:
                continue

            qa_path = f"qa/subject/{subject_dir}/{qa_file}"
            if qa_path in existing_qa_paths:
                continue

            # タイトルを生成
            title = qa_file.replace(suffix, '').split('_', 1)[-1] if '_' in qa_file else qa_file.replace(suffix, '')

            # IDが既に存在する場合、またはこのセッションで既に追加した場合はスキップ
            if title in existing_ids or title in added_titles:
                continue

            added_titles.add(title)
            # 「〇〇学」→「〇〇」に変換（ただし結果が1文字になる場合は変換しない）
            if subject_dir.endswith('学') and len(subject_dir) > 2:
                subject = subject_dir[:-1]
            else:
                subject = subject_dir

            # 対応するHTMLファイルがあれば紐付け
            html_file = qa_file.replace(suffix, '.html')
            html_path = f"html/subject/{subject_dir}/{html_file}"
            html_full_path = os.path.join(BASE_DIR, html_path)
            html_value = f'"{html_path}"' if os.path.exists(html_full_path) else 'null'

            # エントリを文字列として作成
            entry = f'''  {{
    "id": "{title}",
    "title": "{title}",
    "qaPath": "{qa_path}",
    "htmlPath": {html_value},
    "subject": "{subject}",
    "subjectCategory": "基礎"
  }}'''
            new_entries.append(entry)

    if new_entries:
        # 配列の末尾 ]; を見つけて、その前に追加
        insert_pos = content.rfind('];')
        if insert_pos == -1:
            print("ERROR: DATA配列の末尾が見つかりません", file=sys.stderr)
            return 1
        
        # 最後のエントリの後にカンマがあるか確認
        before_bracket = content[:insert_pos].rstrip()
        if not before_bracket.endswith(','):
            before_bracket += ','
        
        new_content = before_bracket + '\n' + ',\n'.join(new_entries) + '\n];'
        
        with open(DATA_JS_PATH, 'w') as f:
            f.write(new_content)
        
        print(f"data.jsに{len(new_entries)}件のQAを追加しました:")
        for entry in new_entries[:5]:
            match = re.search(r'"qaPath": "([^"]+)"', entry)
            if match:
                print(f"  + {match.group(1)}")
        if len(new_entries) > 5:
            print(f"  ... 他{len(new_entries)-5}件")
        return 2  # 変更あり
    
    return 0  # 変更なし

if __name__ == "__main__":
    sys.exit(main())
