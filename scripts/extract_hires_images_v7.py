#!/usr/bin/env python3
"""
高解像度別冊画像から個別写真を切り抜くスクリプト v7

アプローチ変更:
- A/B/Cラベルを検出して、ラベルから次のラベルまでを1画像として切り出す
- これにより「A」「B」ラベルが確実に含まれる
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
    parts = [p.strip() for p in ref_str.split(',')]
    for part in parts:
        match = re.match(r'^(\d+)([A-Z])?$', part.strip())
        if match:
            page = int(match.group(1))
            label = match.group(2)
            results.append((page, label))
    return results


def get_bessatsu_mapping(kai):
    mapping = {}
    with open(CSV_PATH, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['回次'] != str(kai):
                continue
            ref = row.get('別冊参照', '')
            if not ref:
                continue
            code = row['問題コード']
            parsed = parse_bessatsu_ref(ref)
            if parsed:
                mapping[code] = parsed
    return mapping


def is_blank_page(img_array, white_threshold=250):
    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array
    return np.mean(gray > white_threshold) > 0.95


def detect_single_letter_labels(gray, h, w, white_threshold=240):
    """A, B, Cなどの単独大文字ラベルの位置を検出

    Returns:
        list of (y_start, y_end) for each label block
    """
    labels = []
    y = int(h * 0.06)  # ヘッダースキップ

    while y < int(h * 0.95):
        row = gray[y, :]
        non_white = row < white_threshold
        non_white_indices = np.where(non_white)[0]

        if len(non_white_indices) > 0:
            content_width = non_white_indices[-1] - non_white_indices[0]
            content_center = (non_white_indices[0] + non_white_indices[-1]) / 2

            # 単独ラベルの条件：幅が非常に狭く（5%以下）、中央にある
            if content_width < w * 0.05 and w * 0.42 < content_center < w * 0.58:
                # ラベルブロックの範囲を確定
                label_start = y
                label_end = y

                # 上方向に探索
                for check_y in range(y - 1, max(0, y - 50), -1):
                    check_row = gray[check_y, :]
                    check_non_white = np.where(check_row < white_threshold)[0]
                    if len(check_non_white) > 0:
                        cw = check_non_white[-1] - check_non_white[0]
                        cc = (check_non_white[0] + check_non_white[-1]) / 2
                        if cw < w * 0.08 and w * 0.40 < cc < w * 0.60:
                            label_start = check_y
                        else:
                            break
                    elif np.mean(check_row > white_threshold) > 0.99:
                        break

                # 下方向に探索
                for check_y in range(y + 1, min(h, y + 50)):
                    check_row = gray[check_y, :]
                    check_non_white = np.where(check_row < white_threshold)[0]
                    if len(check_non_white) > 0:
                        cw = check_non_white[-1] - check_non_white[0]
                        cc = (check_non_white[0] + check_non_white[-1]) / 2
                        if cw < w * 0.08 and w * 0.40 < cc < w * 0.60:
                            label_end = check_y
                        else:
                            break
                    elif np.mean(check_row > white_threshold) > 0.99:
                        break

                # 既存のラベルと重複しないか確認
                is_new = True
                for existing_start, existing_end in labels:
                    if not (label_end < existing_start or label_start > existing_end):
                        is_new = False
                        break

                if is_new and label_end - label_start > 10:
                    labels.append((label_start, label_end))
                    y = label_end + 10
                    continue

        y += 1

    labels.sort(key=lambda x: x[0])
    return labels


def get_content_x_bounds(gray, y1, y2, white_threshold=240):
    """指定範囲内のコンテンツのX境界を取得"""
    region = gray[y1:y2, :]
    col_has_content = np.mean(region < white_threshold, axis=0) > 0.01
    content_cols = np.where(col_has_content)[0]

    if len(content_cols) == 0:
        return 0, gray.shape[1]

    return content_cols[0], content_cols[-1]


def split_by_labels(img_array, num_expected):
    """ラベル位置を基準に画像を分割"""
    h, w = img_array.shape[:2]

    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array

    # ヘッダー/フッター
    header_end = int(h * 0.08)
    footer_start = int(h * 0.96)

    # ラベル検出
    labels = detect_single_letter_labels(gray, h, w)

    regions = []

    if len(labels) == 0:
        # ラベルなし：全体を1つの画像として
        # コンテンツのある範囲を検出
        row_has_content = np.mean(gray < 240, axis=1) > 0.02
        content_rows = np.where(row_has_content)[0]
        valid_rows = content_rows[(content_rows > header_end) & (content_rows < footer_start)]

        if len(valid_rows) > 0:
            y1 = valid_rows[0]
            y2 = valid_rows[-1]
            x1, x2 = get_content_x_bounds(gray, y1, y2)
            regions.append((max(0, x1 - 5), max(0, y1 - 5),
                           min(w, x2 + 5), min(h, y2 + 5)))

    elif len(labels) == 1:
        # ラベル1つ：そのラベルからフッターまで
        label_start, label_end = labels[0]

        # ラベルの少し上からコンテンツ終端まで
        y1 = max(header_end, label_start - 10)

        # コンテンツ終端を検出
        row_has_content = np.mean(gray < 240, axis=1) > 0.02
        content_rows = np.where(row_has_content)[0]
        valid_rows = content_rows[(content_rows > label_end) & (content_rows < footer_start)]

        if len(valid_rows) > 0:
            y2 = valid_rows[-1] + 20  # キャプション用余白
        else:
            y2 = footer_start

        x1, x2 = get_content_x_bounds(gray, y1, min(y2, footer_start))
        regions.append((max(0, x1 - 5), y1, min(w, x2 + 5), min(footer_start, y2)))

    else:
        # 複数ラベル：各ラベルから次のラベルまで
        for i, (label_start, label_end) in enumerate(labels):
            # 開始：現在のラベルの少し上
            y1 = max(header_end, label_start - 10)

            # 終了：次のラベルの直前、または末尾
            if i + 1 < len(labels):
                next_label_start = labels[i + 1][0]
                y2 = next_label_start - 10
            else:
                # 最後のラベル：コンテンツ終端まで
                row_has_content = np.mean(gray < 240, axis=1) > 0.02
                content_rows = np.where(row_has_content)[0]
                valid_rows = content_rows[(content_rows > label_end) & (content_rows < footer_start)]
                if len(valid_rows) > 0:
                    y2 = valid_rows[-1] + 20
                else:
                    y2 = footer_start

            x1, x2 = get_content_x_bounds(gray, y1, min(y2, footer_start))
            regions.append((max(0, x1 - 5), y1, min(w, x2 + 5), min(footer_start, y2)))

    # 期待数と調整
    if len(regions) < num_expected and len(regions) > 0:
        # 不足分は最後の領域を複製（警告付き）
        while len(regions) < num_expected:
            regions.append(regions[-1])
    elif len(regions) > num_expected:
        regions = regions[:num_expected]

    return regions


def extract_images_for_kai(kai, dry_run=False):
    print(f"\n{'='*50}")
    print(f"第{kai}回 画像抽出 (v7 - ラベル基準)")
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
        section = code[3]
        by_section[section].append((code, refs))

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

                if is_blank_page(img_cv):
                    print(f"  [{code}] 白紙スキップ")
                    skipped += len(labels)
                    continue

                num_expected = len(labels)
                regions = split_by_labels(img_cv, num_expected)

                if len(regions) == 0:
                    print(f"  [{code}] 領域なし")
                    skipped += num_expected
                    continue

                for i, (x1, y1, x2, y2) in enumerate(regions):
                    cropped = img_pil.crop((x1, y1, x2, y2))

                    if cropped.width < 50 or cropped.height < 50:
                        skipped += 1
                        continue

                    if num_expected == 1 and labels[0] is None:
                        output_path = output_dir / f"{code}.png"
                    else:
                        output_path = output_dir / f"{code}_{i+1}.png"

                    if dry_run:
                        print(f"  [{code}] → {output_path.name} {cropped.size}")
                    else:
                        cropped.save(output_path)
                        print(f"  [{code}] → {output_path.name} {cropped.size}")
                    processed += 1

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
        print("python extract_hires_images_v7.py 118")


if __name__ == "__main__":
    main()
