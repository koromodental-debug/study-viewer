#!/usr/bin/env python3
"""
矯正科画像フラッシュカード生成スクリプト

CSVデータから3タイプの画像フラッシュカードを生成:
- Type A: 所見読み取り型（画像→所見）
- Type B: 診断推論型（画像＋所見→診断）
- Type C: 装置選択型（画像＋診断→装置）

出力: JSONファイル
"""

import csv
import json
import os
import re
from pathlib import Path
from collections import defaultdict

# パス設定
BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR.parent / "解説PDF"
IMAGE_DIR = BASE_DIR / "images"  # 国試画像のベースディレクトリ
OUTPUT_DIR = BASE_DIR / "qa" / "subject" / "矯正"

# 入力ファイル
CSV_TOUGOU = DATA_DIR / "矯正_統合分析.csv"
CSV_MAPPING = DATA_DIR / "矯正_所見診断対応表.csv"


def get_kokushi_images(code):
    """問題コードから国試画像のパスを取得"""
    # 問題コードから回次を抽出 (例: 102C25 → 102)
    match = re.match(r'^(\d+)', code)
    if not match:
        return []

    kaiji = match.group(1)
    folder_name = f"{kaiji}回_Web画像"
    folder_path = IMAGE_DIR / folder_name

    if not folder_path.exists():
        return []

    # 画像ファイルを検索
    images = []

    # パターン1: {code}.png
    main_image = folder_path / f"{code}.png"
    if main_image.exists():
        images.append((1, f"{folder_name}/{code}.png"))

    # パターン2: {code}_1.png, {code}_2.png, ...
    for i in range(1, 10):
        numbered_image = folder_path / f"{code}_{i}.png"
        if numbered_image.exists():
            images.append((i + 1, f"{folder_name}/{code}_{i}.png"))

    # 番号順にソート
    images.sort(key=lambda x: x[0])

    return images


def get_image_for_index(code, index):
    """問題コードと画像インデックスから対応する画像パスを取得

    index: 1=画像A, 2=画像B, 3=画像C, ...
    """
    images = get_kokushi_images(code)
    if not images:
        return None

    # インデックスに対応する画像を探す
    for img_index, img_path in images:
        if img_index == index:
            return img_path

    # 見つからない場合、最初の画像を返す（画像Aの場合）
    if index == 1 and images:
        return images[0][1]

    return None


def load_image_files():
    """画像ファイルを問題コードごとにグループ化（国試画像を使用）"""
    # この関数は後方互換性のために残すが、実際にはget_kokushi_imagesを使用
    return defaultdict(list)


def load_diagnosis_mapping():
    """所見→診断→装置のマッピングを読み込み"""
    mapping = []
    if not CSV_MAPPING.exists():
        print(f"警告: {CSV_MAPPING} が見つかりません")
        return mapping

    with open(CSV_MAPPING, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            mapping.append({
                '画像種類': row.get('画像種類', ''),
                '所見': row.get('所見', ''),
                '診断': row.get('診断', ''),
                '確認ポイント': row.get('確認ポイント', ''),
                '関連装置': row.get('関連装置', '')
            })
    return mapping


def load_problem_data():
    """統合分析CSVから問題データを読み込み（画像ごとに分離）"""
    problems = []
    with open(CSV_TOUGOU, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = row.get('問題コード', '')
            if not code:
                continue

            # 102回以降のみ
            kaiji = row.get('回次', '')
            try:
                kaiji_num = int(float(kaiji))
                if kaiji_num < 102:
                    continue
            except:
                continue

            # 画像ラベルとインデックスのマッピング
            # 画像A → _1.png または .png, 画像B → _2.png, 画像C → _3.png, etc.
            label_to_index = {'画像A': 1, '画像B': 2, '画像C': 3, '画像D': 4, '画像E': 5}

            # 画像種類の推定
            image_types = {
                '画像A': '顔貌写真',
                '画像B': '口腔内写真',
                '画像C': 'X線写真',
                '画像D': '装置・その他',
                '画像E': 'その他'
            }

            # 各画像のアノテーションを個別に収集
            for col in ['画像A', '画像B', '画像C', '画像D', '画像E']:
                finding = row.get(col, '').strip()
                if finding and len(finding) > 3:  # 短すぎるアノテーションは除外
                    problems.append({
                        'code': code,
                        'kaiji': kaiji_num,
                        'image_label': col,
                        'image_index': label_to_index[col],
                        'image_type': image_types[col],
                        '問題文': row.get('問題文', ''),
                        '正解': row.get('正解', ''),
                        'キーワード': row.get('キーワードタグ', ''),
                        'annotation': finding
                    })

    return problems


def clean_finding_text(text):
    """所見テキストをクリーンアップ"""
    # 不要な記号や重複を削除
    text = re.sub(r'[／/]', '\n', text)
    text = re.sub(r'、', '\n', text)
    text = re.sub(r'・', '\n・', text)

    # 行ごとに処理
    lines = []
    for line in text.split('\n'):
        line = line.strip()
        if line and len(line) > 1:  # 1文字だけの行は除外
            # 先頭が・でなければ追加
            if not line.startswith('・'):
                line = '・' + line
            lines.append(line)

    return '\n'.join(lines)


def extract_diagnosis_from_findings(findings_text, mapping):
    """所見テキストから診断と装置を推定"""
    diagnoses = []
    devices = []

    findings_lower = findings_text.lower()

    for m in mapping:
        shoken = m['所見'].lower()
        if shoken and shoken in findings_lower:
            if m['診断']:
                diagnoses.append(m['診断'])
            if m['関連装置']:
                devices.append(m['関連装置'])

    # キーワードベースの追加判定
    keyword_diagnosis = {
        'コンベックス': '骨格性II級（上顎前突 or 下顎後退）',
        'コンケイブ': '骨格性III級（下顎前突 or 上顎劣成長）',
        'ストレート': '骨格性I級 or 機能性不正咬合',
        '反対咬合': '反対咬合',
        '開咬': '開咬',
        '過蓋咬合': '過蓋咬合',
        '叢生': '叢生',
        '正中離開': '正中離開',
        '交叉咬合': '交叉咬合',
        'Angle II': 'Angle II級不正咬合',
        'Angle III': 'Angle III級不正咬合',
    }

    keyword_device = {
        'ヘッドギア': 'ヘッドギア',
        'アクチバトール': 'アクチバトール',
        '舌側弧線': '舌側弧線装置（リンガルアーチ）',
        '拡大': '拡大装置',
        'クワドヘリックス': 'クワドヘリックス',
        '上顎前方牽引': '上顎前方牽引装置',
        'マルチブラケット': 'マルチブラケット装置',
        '外科矯正': '外科矯正',
    }

    for kw, diag in keyword_diagnosis.items():
        if kw in findings_text and diag not in diagnoses:
            diagnoses.append(diag)

    for kw, dev in keyword_device.items():
        if kw in findings_text and dev not in devices:
            devices.append(dev)

    return list(set(diagnoses)), list(set(devices))


def generate_flashcards(problems, image_map, mapping):
    """フラッシュカードを生成（画像ごと）"""

    type_a_cards = []  # 所見読み取り型
    type_b_cards = []  # 診断推論型
    type_c_cards = []  # 装置選択型

    skipped_no_image = 0

    for prob in problems:
        code = prob['code']
        image_index = prob['image_index']
        image_type = prob['image_type']
        annotation = prob['annotation']
        image_label = prob['image_label']

        # 対応する国試画像を取得
        image_path_rel = get_image_for_index(code, image_index)
        if not image_path_rel:
            skipped_no_image += 1
            continue

        image_path = f"../images/{image_path_rel}"

        # アノテーションをクリーンアップ
        cleaned_annotation = clean_finding_text(annotation)
        if not cleaned_annotation or len(cleaned_annotation) < 5:
            continue

        # 診断と装置を推定
        diagnoses, devices = extract_diagnosis_from_findings(annotation, mapping)

        # Type A: 所見読み取り型
        type_a_cards.append({
            "question": f"<img src='{image_path}' />\n\n【{image_type}】この画像から読み取れる所見は？",
            "answer": cleaned_annotation,
            "code": f"{code}_{image_label}",
            "imageType": "finding"
        })

        # Type B: 診断推論型（診断が推定できた場合のみ）
        if diagnoses:
            type_b_cards.append({
                "question": f"<img src='{image_path}' />\n\n【{image_type}の所見】\n{cleaned_annotation}\n\nこの所見から考えられる診断は？",
                "answer": '\n'.join([f"・{d}" for d in diagnoses]),
                "code": f"{code}_{image_label}",
                "imageType": "diagnosis"
            })

        # Type C: 装置選択型（装置が推定できた場合のみ）
        if devices and diagnoses:
            diag_text = '、'.join(diagnoses[:2])
            type_c_cards.append({
                "question": f"<img src='{image_path}' />\n\n【診断】{diag_text}\n\nこの症例に適した矯正装置は？",
                "answer": '\n'.join([f"・{d}" for d in devices]),
                "code": f"{code}_{image_label}",
                "imageType": "device"
            })

    if skipped_no_image > 0:
        print(f"   ※国試画像なし: {skipped_no_image}問スキップ")

    return type_a_cards, type_b_cards, type_c_cards


def main():
    print("=" * 50)
    print("矯正科画像フラッシュカード生成")
    print("=" * 50)

    # データ読み込み
    print("\n1. データ読み込み中...")

    mapping = load_diagnosis_mapping()
    print(f"   所見診断マッピング: {len(mapping)}件")

    problems = load_problem_data()
    print(f"   問題データ: {len(problems)}件")

    # 国試画像の存在確認
    with_images = sum(1 for p in problems if get_kokushi_images(p['code']))
    print(f"   国試画像あり: {with_images}問")

    # フラッシュカード生成
    print("\n2. フラッシュカード生成中...")
    type_a, type_b, type_c = generate_flashcards(problems, None, mapping)
    print(f"   Type A（所見読み取り）: {len(type_a)}枚")
    print(f"   Type B（診断推論）: {len(type_b)}枚")
    print(f"   Type C（装置選択）: {len(type_c)}枚")

    # JSON出力
    print("\n3. JSON出力中...")

    output = {
        "metadata": {
            "title": "矯正科 画像問題",
            "category": "矯正",
            "chapter": "画像診断",
            "cardType": "image",
            "generatedAt": "",
            "totalCards": len(type_a) + len(type_b) + len(type_c)
        },
        "sections": [
            {
                "section": "所見読み取り",
                "description": "画像から読み取れる所見を答える",
                "qa": type_a
            },
            {
                "section": "診断推論",
                "description": "所見から診断を導く",
                "qa": type_b
            },
            {
                "section": "装置選択",
                "description": "診断から適切な装置を選ぶ",
                "qa": type_c
            }
        ]
    }

    # 出力ディレクトリ作成
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    output_path = OUTPUT_DIR / "00_画像診断_QA.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"   出力: {output_path}")

    # TXT形式も出力（既存形式との互換性のため）
    txt_output_path = OUTPUT_DIR / "00_画像診断_QA.txt"
    with open(txt_output_path, 'w', encoding='utf-8') as f:
        f.write("# 矯正科 画像診断\n\n")

        f.write("## 所見読み取り\n\n")
        for card in type_a:
            # questionからimgタグを抽出
            f.write(f"Q: [{card['code']}] {card['question']}\n")
            f.write(f"A: {card['answer']}\n\n")

        f.write("---\n\n## 診断推論\n\n")
        for card in type_b:
            f.write(f"Q: [{card['code']}] {card['question']}\n")
            f.write(f"A: {card['answer']}\n\n")

        f.write("---\n\n## 装置選択\n\n")
        for card in type_c:
            f.write(f"Q: [{card['code']}] {card['question']}\n")
            f.write(f"A: {card['answer']}\n\n")

    print(f"   TXT出力: {txt_output_path}")

    print("\n" + "=" * 50)
    print(f"生成完了: 合計 {len(type_a) + len(type_b) + len(type_c)} カード")
    print("=" * 50)


if __name__ == "__main__":
    main()
