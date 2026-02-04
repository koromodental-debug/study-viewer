#!/usr/bin/env python3
"""
_QA.txtを_QA.jsonに変換するスクリプト
テキストQ&A + HTMLの表穴埋めを統合

進捗データは topicId:originalIndex で保存されているため、
テキストQ&Aを先にパースして既存の順序を維持し、
表穴埋めカードは末尾に追加する。
"""

import os
import json
import re
from pathlib import Path
from bs4 import BeautifulSoup


def parse_txt_qa(txt_path):
    """
    テキスト形式のQ&Aをパース

    対応形式:
    - ## セクション名
    - Q: 質問
    - A: 回答（複数行対応）
    - [混同注意] などの注釈
    - [102A124] ★★★ 形式の過去問
    - [他の選択肢との違い] セクション
    - [ポイント] セクション
    - --- 区切り
    """
    with open(txt_path, 'r', encoding='utf-8') as f:
        content = f.read()

    sections = []
    current_section = "基礎知識"  # デフォルトセクション
    current_qa_list = []

    lines = content.split('\n')
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # 空行やセパレータはスキップ
        if not stripped or stripped == '---':
            i += 1
            continue

        # メタデータ行（@brushup等）はスキップ
        if stripped.startswith('@'):
            i += 1
            continue

        # セクション見出し（## で始まる）
        if stripped.startswith('## '):
            # 前のセクションを保存
            if current_qa_list:
                sections.append({
                    'section': current_section,
                    'qa': current_qa_list
                })
                current_qa_list = []
            current_section = stripped[3:].strip()
            i += 1
            continue

        # 過去問形式（[102A124] ★★★）
        past_exam_match = re.match(r'^\[(\d{3}[A-Z]\d+)\](.*)$', stripped)
        if past_exam_match:
            exam_code = past_exam_match.group(1)
            stars = past_exam_match.group(2).strip()

            # 次の行からQ&Aを読み取り
            i += 1
            qa_result = parse_single_qa_with_extras(lines, i, exam_code, stars)
            if qa_result:
                current_qa_list.append(qa_result['qa'])
                i = qa_result['next_index']
            continue

        # 通常のQ&Aペア
        if stripped.startswith('Q: ') or stripped.startswith('Q：'):
            qa_result = parse_single_qa(lines, i)
            if qa_result:
                current_qa_list.append(qa_result['qa'])
                i = qa_result['next_index']
            continue

        i += 1

    # 最後のセクションを保存
    if current_qa_list:
        sections.append({
            'section': current_section,
            'qa': current_qa_list
        })

    return sections


def parse_single_qa(lines, start_index):
    """
    通常のQ&Aペアをパース
    """
    i = start_index
    line = lines[i].strip()

    # Q: で始まる行
    if line.startswith('Q: '):
        question = line[3:].strip()
    elif line.startswith('Q：'):
        question = line[2:].strip()
    else:
        return None

    i += 1
    answer_lines = []
    extra_lines = []

    # 次の行からAnswerを探す
    while i < len(lines):
        current = lines[i]
        stripped = current.strip()

        # 次のQ&Aや区切りに到達したら終了
        if stripped.startswith('Q: ') or stripped.startswith('Q：'):
            break
        if stripped.startswith('## '):
            break
        if re.match(r'^\[\d{3}[A-Z]\d+\]', stripped):
            break
        if stripped == '---':
            i += 1
            break

        # A: で始まる行
        if stripped.startswith('A: ') or stripped.startswith('A：'):
            if stripped.startswith('A: '):
                answer_lines.append(stripped[3:])
            else:
                answer_lines.append(stripped[2:])
        # インデント継続行（3スペース以上）または追加情報
        elif current.startswith('   ') or current.startswith('\t'):
            # [混同注意] などはextra_linesに
            if stripped.startswith('['):
                extra_lines.append(stripped)
            elif answer_lines:
                answer_lines.append(stripped)
        # [関連質問] などの追加情報
        elif stripped.startswith('['):
            extra_lines.append(stripped)
        # その他の行（追加情報の継続行）
        elif extra_lines and stripped:
            extra_lines.append(stripped)

        i += 1

    if answer_lines:
        answer = '\n'.join(answer_lines)
        # 追加情報を結合
        if extra_lines:
            answer += '\n\n' + '\n'.join(extra_lines)
        return {
            'qa': {
                'question': question,
                'answer': answer.strip()
            },
            'next_index': i
        }

    return None


def parse_single_qa_with_extras(lines, start_index, exam_code, stars):
    """
    過去問形式のQ&Aをパース（[他の選択肢との違い]、[ポイント]含む）
    """
    i = start_index
    question = None
    answer_lines = []
    choices_lines = []
    point_lines = []
    current_section = None  # 'answer', 'choices', 'point'

    while i < len(lines):
        current = lines[i]
        stripped = current.strip()

        # 次のQ&Aや区切りに到達したら終了
        if re.match(r'^\[\d{3}[A-Z]\d+\]', stripped):
            break
        if stripped.startswith('## '):
            break
        if stripped == '---':
            i += 1
            break

        # Q: で始まる行
        if stripped.startswith('Q: ') or stripped.startswith('Q：'):
            if question is None:
                if stripped.startswith('Q: '):
                    question = stripped[3:].strip()
                else:
                    question = stripped[2:].strip()
                current_section = 'question'
            else:
                # 次のQ&Aに到達
                break
            i += 1
            continue

        # A: で始まる行
        if stripped.startswith('A: ') or stripped.startswith('A：'):
            if stripped.startswith('A: '):
                answer_lines.append(stripped[3:])
            else:
                answer_lines.append(stripped[2:])
            current_section = 'answer'
            i += 1
            continue

        # [他の選択肢との違い] セクション
        if stripped.startswith('[他の選択肢との違い]') or stripped.startswith('[他の選択肢]'):
            current_section = 'choices'
            i += 1
            continue

        # [ポイント] セクション
        if stripped.startswith('[ポイント]'):
            current_section = 'point'
            i += 1
            continue

        # 空行
        if not stripped:
            i += 1
            continue

        # 継続行の処理
        if current_section == 'answer':
            if current.startswith('   ') or current.startswith('\t'):
                answer_lines.append(stripped)
        elif current_section == 'choices':
            choices_lines.append(stripped)
        elif current_section == 'point':
            point_lines.append(stripped)

        i += 1

    if question and answer_lines:
        # 回答を構築
        answer = '\n'.join(answer_lines)

        # [他の選択肢との違い]を追加
        if choices_lines:
            answer += '\n\n[他の選択肢との違い]\n' + '\n'.join(choices_lines)

        # [ポイント]を追加
        if point_lines:
            answer += '\n\n[ポイント]\n' + '\n'.join(point_lines)

        # 問題コードと重要度を質問に追加
        formatted_question = question
        if stars:
            formatted_question = f"[{exam_code}] {stars}\n{question}"
        else:
            formatted_question = f"[{exam_code}]\n{question}"

        return {
            'qa': {
                'question': formatted_question,
                'answer': answer.strip()
            },
            'next_index': i
        }

    return None


def extract_tables_from_html(html_path):
    """HTMLファイルから表を抽出してtable-occlusionカードを生成"""
    if not html_path.exists():
        return []

    with open(html_path, 'r', encoding='utf-8') as f:
        html = f.read()

    soup = BeautifulSoup(html, 'html.parser')
    tables_data = []

    for table in soup.find_all('table'):
        # 直前の見出しを取得
        prev_h2 = table.find_previous('h2')
        section = prev_h2.get_text(strip=True) if prev_h2 else '表'

        rows = table.find_all('tr')
        if len(rows) < 2:
            continue

        # ヘッダー行
        header_cells = rows[0].find_all(['th', 'td'])
        headers = [cell.get_text(strip=True) for cell in header_cells]

        if len(headers) < 2:
            continue

        # データ行
        data_rows = []
        for row in rows[1:]:
            cells = row.find_all(['td', 'th'])
            values = [cell.get_text(strip=True) for cell in cells]
            if len(values) >= 2:
                data_rows.append(values)

        if not data_rows:
            continue

        # 穴埋め対象セルを決定（ヘッダー列以外の非空セル）
        occlusions = []
        for row_idx, row_data in enumerate(data_rows):
            for col_idx in range(1, len(row_data)):
                if row_data[col_idx] and row_data[col_idx] != '-':
                    occlusions.append({"row": row_idx, "col": col_idx})

        if occlusions:
            tables_data.append({
                "type": "table-occlusion",
                "title": section,
                "table": {
                    "headers": headers,
                    "rows": data_rows
                },
                "occlusions": occlusions
            })

    return tables_data


def convert_txt_to_json(txt_path, html_path=None):
    """
    テキストQ&AをJSONに変換

    Args:
        txt_path: Q&Aテキストファイルのパス
        html_path: 対応するHTMLファイルのパス（表抽出用）

    Returns:
        dict: JSON形式のデータ
    """
    # テキストQ&Aをパース
    sections = parse_txt_qa(txt_path)

    # HTMLから表を抽出
    if html_path and html_path.exists():
        tables = extract_tables_from_html(html_path)
        if tables:
            sections.append({
                'section': '表穴埋め',
                'qa': tables
            })

    # メタデータを生成
    stem = Path(txt_path).stem.replace('_QA', '')
    parts = stem.split('_', 2)

    metadata = {
        'title': parts[-1] if len(parts) > 0 else stem,
        'chapter': parts[1] if len(parts) > 1 else '',
        'category': ''
    }

    return {
        'metadata': metadata,
        'sections': sections
    }


def process_subject(subject_name, study_viewer_dir):
    """科目全体を処理"""
    qa_dir = Path(study_viewer_dir) / 'qa' / 'subject' / subject_name
    html_dir = Path(study_viewer_dir) / 'html' / 'subject' / subject_name

    if not qa_dir.exists():
        print(f"QAディレクトリが見つかりません: {qa_dir}")
        return 0

    results = []
    total_qa = 0
    total_tables = 0

    # .txtファイルを処理
    txt_files = sorted(qa_dir.glob('*_QA.txt'))

    for txt_file in txt_files:
        # 対応するHTMLファイルを探す
        html_stem = txt_file.stem.replace('_QA', '')
        html_file = html_dir / f"{html_stem}.html"

        # 変換
        json_data = convert_txt_to_json(txt_file, html_file if html_file.exists() else None)

        # Q&A数と表数をカウント
        qa_count = 0
        table_count = 0
        for section in json_data['sections']:
            for qa in section['qa']:
                if qa.get('type') == 'table-occlusion':
                    table_count += len(qa.get('occlusions', []))
                else:
                    qa_count += 1

        # JSONファイルに保存
        json_file = txt_file.with_name(txt_file.name.replace('_QA.txt', '_QA.json'))
        with open(json_file, 'w', encoding='utf-8') as f:
            json.dump(json_data, f, ensure_ascii=False, indent=2)

        total_qa += qa_count
        total_tables += table_count

        msg = f"{qa_count}問"
        if table_count > 0:
            msg += f" + {table_count}穴埋め"
        results.append(f"  ✓ {txt_file.stem}: {msg}")

    print(f"\n=== {subject_name} ===")
    for r in results:
        print(r)
    print(f"\n合計: {total_qa}問 + {total_tables}穴埋め")

    return total_qa + total_tables


def process_all_subjects(study_viewer_dir):
    """全科目を処理"""
    qa_subject_dir = Path(study_viewer_dir) / 'qa' / 'subject'

    if not qa_subject_dir.exists():
        print(f"QA科目ディレクトリが見つかりません: {qa_subject_dir}")
        return

    total = 0
    subjects = sorted([d.name for d in qa_subject_dir.iterdir() if d.is_dir()])

    for subject in subjects:
        count = process_subject(subject, study_viewer_dir)
        total += count

    print(f"\n{'='*50}")
    print(f"全科目合計: {total}カード")


def main():
    import argparse
    parser = argparse.ArgumentParser(description='_QA.txtを_QA.jsonに変換')
    parser.add_argument('subject', nargs='?', help='科目名（省略で全科目）')
    parser.add_argument('--all', action='store_true', help='全科目を処理')
    args = parser.parse_args()

    # スクリプトのディレクトリからstudy-viewerを特定
    script_dir = Path(__file__).parent.parent  # study-viewer

    if args.all or not args.subject:
        process_all_subjects(script_dir)
    else:
        process_subject(args.subject, script_dir)


if __name__ == '__main__':
    main()
