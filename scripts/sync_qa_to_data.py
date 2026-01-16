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

    # 既存のqaPathを収集
    existing_qa_paths = set(re.findall(r'"qaPath":\s*"([^"]+)"', content))

    # qa/subject/内のQAファイルをスキャン
    new_entries = []
    for subject_dir in sorted(os.listdir(QA_SUBJECT_DIR)):
        subject_path = os.path.join(QA_SUBJECT_DIR, subject_dir)
        if not os.path.isdir(subject_path):
            continue
        
        for qa_file in sorted(os.listdir(subject_path)):
            if not qa_file.endswith('_QA.txt'):
                continue
            
            qa_path = f"qa/subject/{subject_dir}/{qa_file}"
            if qa_path in existing_qa_paths:
                continue
            
            # タイトルを生成
            title = qa_file.replace('_QA.txt', '').split('_', 1)[-1] if '_' in qa_file else qa_file.replace('_QA.txt', '')
            subject = subject_dir.replace('学', '')
            
            # エントリを文字列として作成
            entry = f'''  {{
    "id": "{title}",
    "title": "{title}",
    "qaPath": "{qa_path}",
    "htmlPath": null,
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
