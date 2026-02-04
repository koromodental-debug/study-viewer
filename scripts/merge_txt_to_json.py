#!/usr/bin/env python3
"""
_QA.txtの内容を_QA.jsonに統合するスクリプト
基礎知識Q&A（テキスト）+ 過去問（JSON）+ 表穴埋め（JSON）を1つのJSONにマージ
"""

import os
import json
import re
from pathlib import Path


def parse_txt_qa(txt_path):
    """テキスト形式のQ&Aをパース"""
    with open(txt_path, 'r', encoding='utf-8') as f:
        content = f.read()

    sections = []
    current_section = None
    current_qa_list = []

    lines = content.split('\n')
    i = 0

    while i < len(lines):
        line = lines[i].strip()

        # セクション見出し（## で始まる）
        if line.startswith('## '):
            # 前のセクションを保存
            if current_section and current_qa_list:
                sections.append({
                    'section': current_section,
                    'qa': current_qa_list
                })
            current_section = line[3:].strip()
            current_qa_list = []
            i += 1
            continue

        # Q&Aペア
        if line.startswith('Q: '):
            question = line[3:].strip()

            # 次の行からAnswerを探す
            i += 1
            answer_lines = []
            while i < len(lines):
                answer_line = lines[i]
                if answer_line.strip().startswith('A: '):
                    answer_lines.append(answer_line.strip()[3:])
                    i += 1
                    # 複数行の回答を処理（インデント継続行）
                    while i < len(lines) and lines[i].startswith('   '):
                        answer_lines.append(lines[i].strip())
                        i += 1
                    break
                i += 1

            if answer_lines:
                answer = '\n'.join(answer_lines)
                current_qa_list.append({
                    'question': question,
                    'answer': answer
                })
            continue

        i += 1

    # 最後のセクションを保存
    if current_section and current_qa_list:
        sections.append({
            'section': current_section,
            'qa': current_qa_list
        })

    return sections


def merge_txt_to_json(txt_path, json_path):
    """テキストQ&AをJSONに統合"""
    # テキストQ&Aをパース
    txt_sections = parse_txt_qa(txt_path)

    if not txt_sections:
        return None, "テキストQ&Aなし"

    # 既存のJSONを読み込み
    if os.path.exists(json_path):
        with open(json_path, 'r', encoding='utf-8') as f:
            json_data = json.load(f)
    else:
        # JSONがない場合は新規作成
        json_data = {
            'metadata': {
                'title': Path(txt_path).stem.replace('_QA', ''),
                'category': '',
                'chapter': ''
            },
            'sections': []
        }

    # 既存セクション名を取得
    existing_section_names = {s['section'] for s in json_data.get('sections', [])}

    # テキストQ&Aのセクションを先頭に追加（重複除外）
    new_sections = []
    for section in txt_sections:
        if section['section'] not in existing_section_names:
            new_sections.append(section)

    # 新しいセクションを先頭に、既存セクション（過去問、表穴埋め）を後ろに
    json_data['sections'] = new_sections + json_data.get('sections', [])

    # JSONを保存
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)

    return len(new_sections), f"{sum(len(s['qa']) for s in new_sections)}問追加"


def process_subject(subject_name, qa_dir):
    """科目全体を処理"""
    qa_subject_dir = Path(qa_dir) / 'subject' / subject_name

    if not qa_subject_dir.exists():
        print(f"QAディレクトリが見つかりません: {qa_subject_dir}")
        return

    results = []
    total_qa = 0

    # .txtファイルを探す
    txt_files = sorted(qa_subject_dir.glob('*_QA.txt'))

    for txt_file in txt_files:
        # 対応するJSONファイル
        json_file = txt_file.with_name(txt_file.name.replace('_QA.txt', '_QA.json'))

        count, msg = merge_txt_to_json(txt_file, json_file)
        if count:
            total_qa += sum(len(s['qa']) for s in parse_txt_qa(txt_file))
            results.append(f"  ✓ {txt_file.stem}: {msg}")
        else:
            results.append(f"  - {txt_file.stem}: {msg}")

    print(f"\n=== {subject_name} ===")
    for r in results:
        print(r)
    print(f"\n合計: {total_qa}問を統合完了")

    return total_qa


def main():
    import argparse
    parser = argparse.ArgumentParser(description='テキストQ&AをJSONに統合')
    parser.add_argument('subject', help='科目名（例: 矯正）')
    parser.add_argument('--qa-dir', default='qa', help='QAディレクトリ')
    args = parser.parse_args()

    # スクリプトのディレクトリからの相対パスを解決
    script_dir = Path(__file__).parent.parent  # study-viewer
    qa_dir = script_dir / args.qa_dir

    process_subject(args.subject, qa_dir)


if __name__ == '__main__':
    main()
