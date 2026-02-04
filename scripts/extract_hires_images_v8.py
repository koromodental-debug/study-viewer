#!/usr/bin/env python3
"""
高解像度別冊画像から個別写真を切り抜くスクリプト v8

改善: 白い帯を検出し、その後のラベル+写真を1単位として切り出す
"""

import csv
import re
from pathlib import Path
from PIL import Image
import numpy as np
import cv2
from collections import defaultdict

BASE_DIR = Path("/Users/saitouryuuichi/Desktop/国試データベース")
KAKOMON_DIR = BASE_DIR / "国家試験過去問"
CSV_PATH = BASE_DIR / "問題抽出ツール" / "データベース" / "all_questions.csv"


def parse_bessatsu_ref(ref_str):
    if not ref_str:
        return []
    results = []
    for part in [p.strip() for p in ref_str.split(',')]:
        match = re.match(r'^(\d+)([A-Z])?$', part)
        if match:
            results.append((int(match.group(1)), match.group(2)))
    return results


def get_bessatsu_mapping(kai):
    mapping = {}
    with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            if row['回次'] != str(kai):
                continue
            ref = row.get('別冊参照', '')
            if ref:
                parsed = parse_bessatsu_ref(ref)
                if parsed:
                    mapping[row['問題コード']] = parsed
    return mapping


def is_blank_page(gray):
    return np.mean(gray > 250) > 0.95


def find_content_sections(gray, white_threshold=240):
    """白い帯で区切られたコンテンツセクションを検出

    Returns:
        list of (start_y, end_y) for each section
    """
    h, w = gray.shape

    # 行ごとの白さを計算
    row_whiteness = np.mean(gray > white_threshold, axis=1)

    # ヘッダー（上部8%）とフッター（下部4%）を除外
    header_end = int(h * 0.08)
    footer_start = int(h * 0.96)

    sections = []
    in_content = False
    section_start = 0

    for y in range(header_end, footer_start):
        is_white_row = row_whiteness[y] > 0.95

        if not is_white_row and not in_content:
            # コンテンツ開始
            in_content = True
            section_start = y
        elif is_white_row and in_content:
            # 白い行に入った
            # 連続する白い行が30行以上なら区切り
            white_count = 0
            for check_y in range(y, min(footer_start, y + 100)):
                if row_whiteness[check_y] > 0.95:
                    white_count += 1
                else:
                    break

            if white_count >= 30:
                # セクション終了
                sections.append((section_start, y))
                in_content = False

    # 最後のセクション
    if in_content:
        sections.append((section_start, footer_start))

    return sections


def trim_section(gray, y1, y2, white_threshold=240):
    """セクションの上下の余白をトリム（ラベルも含める）"""
    h, w = gray.shape

    # 行ごとのコンテンツ存在チェック
    row_has_content = np.mean(gray[y1:y2, :] < white_threshold, axis=1) > 0.01

    content_rows = np.where(row_has_content)[0]
    if len(content_rows) == 0:
        return y1, y2

    # 最初のコンテンツ行を取得
    first_content = y1 + content_rows[0]
    last_content = y1 + content_rows[-1]

    # 上方向にラベルを探す（最大80px上まで）
    new_y1 = first_content
    for check_y in range(first_content - 1, max(y1, first_content - 80), -1):
        row = gray[check_y, :]
        non_white = np.where(row < white_threshold)[0]
        if len(non_white) > 0:
            # コンテンツがある
            new_y1 = check_y

    # 下方向にキャプションを含める
    new_y2 = last_content + 1

    # 余白を追加
    new_y1 = max(y1, new_y1 - 10)
    new_y2 = min(y2, new_y2 + 30)

    return new_y1, new_y2


def get_x_bounds(gray, y1, y2, white_threshold=240):
    """指定範囲のX境界を取得"""
    region = gray[y1:y2, :]
    col_has_content = np.mean(region < white_threshold, axis=0) > 0.005

    cols = np.where(col_has_content)[0]
    if len(cols) == 0:
        return 0, gray.shape[1]

    return max(0, cols[0] - 5), min(gray.shape[1], cols[-1] + 5)


def split_page(img_array, num_expected):
    """ページを分割"""
    h, w = img_array.shape[:2]

    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array

    if is_blank_page(gray):
        return []

    # コンテンツセクションを検出
    sections = find_content_sections(gray)

    if len(sections) == 0:
        # セクションが見つからない場合、全体を1つとして
        header_end = int(h * 0.08)
        footer_start = int(h * 0.96)
        y1, y2 = trim_section(gray, header_end, footer_start)
        x1, x2 = get_x_bounds(gray, y1, y2)
        return [(x1, y1, x2, y2)]

    # セクションをトリムして領域を作成
    regions = []
    for y1, y2 in sections:
        trimmed_y1, trimmed_y2 = trim_section(gray, y1, y2)
        x1, x2 = get_x_bounds(gray, trimmed_y1, trimmed_y2)

        # 最小サイズチェック
        if trimmed_y2 - trimmed_y1 > 50 and x2 - x1 > 50:
            regions.append((x1, trimmed_y1, x2, trimmed_y2))

    # 期待数と調整
    if len(regions) == 0:
        return []

    if len(regions) < num_expected:
        # 不足分は警告のみ
        pass
    elif len(regions) > num_expected:
        regions = regions[:num_expected]

    return regions


def extract_images_for_kai(kai, dry_run=False):
    print(f"\n{'='*50}")
    print(f"第{kai}回 画像抽出 (v8)")
    print(f"{'='*50}")

    mapping = get_bessatsu_mapping(kai)
    print(f"別冊参照あり: {len(mapping)}問")

    if not mapping:
        return 0, 0

    bessatsu_dir = KAKOMON_DIR / f"{kai}回" / "別冊"
    if not bessatsu_dir.exists():
        return 0, 0

    output_dir = KAKOMON_DIR / f"{kai}回" / "切り抜き"
    if not dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    by_section = defaultdict(list)
    for code, refs in mapping.items():
        by_section[code[3]].append((code, refs))

    processed = 0
    skipped = 0

    for section in ['A', 'B', 'C', 'D']:
        if section not in by_section:
            continue

        print(f"\n--- {kai}{section} ---")

        for code, refs in by_section[section]:
            by_page = defaultdict(list)
            for page, label in refs:
                by_page[page].append(label)

            for page_num, labels in by_page.items():
                bessatsu_file = bessatsu_dir / f"{kai}{section}_別冊{page_num:02d}.png"
                if not bessatsu_file.exists():
                    skipped += len(labels)
                    continue

                img_cv = cv2.imread(str(bessatsu_file))
                if img_cv is None:
                    skipped += len(labels)
                    continue

                img_cv = cv2.cvtColor(img_cv, cv2.COLOR_BGR2RGB)
                img_pil = Image.open(bessatsu_file)

                gray = cv2.cvtColor(img_cv, cv2.COLOR_RGB2GRAY)
                if is_blank_page(gray):
                    print(f"  [{code}] 白紙")
                    skipped += len(labels)
                    continue

                num_expected = len(labels)
                regions = split_page(img_cv, num_expected)

                if len(regions) == 0:
                    print(f"  [{code}] 領域なし")
                    skipped += num_expected
                    continue

                if len(regions) < num_expected:
                    print(f"  [{code}] 検出{len(regions)} < 期待{num_expected}")

                for i, (x1, y1, x2, y2) in enumerate(regions):
                    if i >= num_expected:
                        break

                    cropped = img_pil.crop((x1, y1, x2, y2))

                    if cropped.width < 50 or cropped.height < 50:
                        skipped += 1
                        continue

                    if num_expected == 1 and labels[0] is None:
                        fname = f"{code}.png"
                    else:
                        fname = f"{code}_{i+1}.png"

                    output_path = output_dir / fname

                    if not dry_run:
                        cropped.save(output_path)
                    print(f"  [{code}] → {fname} {cropped.size}")
                    processed += 1

                skipped += max(0, num_expected - len(regions))

    print(f"\n完了: {processed}枚、スキップ: {skipped}枚")
    print(f"出力: {output_dir}")
    return processed, skipped


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('kai', type=int, nargs='?')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--all', action='store_true')
    args = parser.parse_args()

    if args.all:
        for kai in range(102, 118):
            extract_images_for_kai(kai, args.dry_run)
    elif args.kai:
        extract_images_for_kai(args.kai, args.dry_run)
    else:
        print("python extract_hires_images_v8.py 118")


if __name__ == "__main__":
    main()
