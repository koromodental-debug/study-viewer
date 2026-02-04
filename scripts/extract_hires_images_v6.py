#!/usr/bin/env python3
"""
高解像度別冊画像から個別写真を切り抜くスクリプト v6

v5からの改善:
- 写真 + その下のキャプション（窩洞形成前、窩洞形成後など）を一緒に切り出す
"""

import csv
import re
from pathlib import Path
from PIL import Image
import numpy as np
import cv2
from collections import defaultdict

# パス設定
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
    white_ratio = np.mean(gray > white_threshold)
    return white_ratio > 0.95


def find_label_rows(gray, h, w, white_threshold=240):
    """A, B, Cなどのラベル行を検出"""
    label_rows = []

    for y in range(int(h * 0.08), int(h * 0.96)):
        row = gray[y, :]
        non_white = row < white_threshold
        non_white_indices = np.where(non_white)[0]

        if len(non_white_indices) > 0:
            content_width = non_white_indices[-1] - non_white_indices[0]
            content_center = (non_white_indices[0] + non_white_indices[-1]) / 2

            # ラベルの条件：幅が狭く（8%以下）、中央にある
            if content_width < w * 0.08 and w * 0.40 < content_center < w * 0.60:
                # 上下の行もチェックして、ラベルブロックかどうか確認
                label_rows.append(y)

    # 連続するラベル行をグループ化
    label_blocks = []
    if label_rows:
        block_start = label_rows[0]
        prev_y = label_rows[0]
        for y in label_rows[1:]:
            if y - prev_y > 5:  # 5行以上離れていたら別ブロック
                label_blocks.append((block_start, prev_y))
                block_start = y
            prev_y = y
        label_blocks.append((block_start, prev_y))

    return label_blocks


def detect_photos_with_captions(img_array, min_area_ratio=0.02):
    """写真領域を検出し、キャプションも含める"""
    h, w = img_array.shape[:2]
    min_area = h * w * min_area_ratio

    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array

    # ヘッダー/フッター
    header_end = int(h * 0.08)
    footer_start = int(h * 0.96)

    # A, B, Cラベルの位置を検出
    label_blocks = find_label_rows(gray, h, w)

    # 白以外の領域を検出
    _, binary = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)

    # ヘッダー/フッターをマスク
    binary[:header_end, :] = 0
    binary[footer_start:, :] = 0

    # A, B, Cラベル行をマスク（写真検出から除外）
    for block_start, block_end in label_blocks:
        # ラベルの前後10行もマスク
        mask_start = max(0, block_start - 10)
        mask_end = min(h, block_end + 10)
        # 中央部分のみマスク（写真は端まで広がっているので）
        center_start = int(w * 0.35)
        center_end = int(w * 0.65)
        binary[mask_start:mask_end, center_start:center_end] = 0

    # モルフォロジー処理
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (10, 10))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=5)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=2)

    # 輪郭検出
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    regions = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area > min_area:
            x, y, bw, bh = cv2.boundingRect(contour)
            if bw > w * 0.15 and bh > h * 0.08:
                regions.append([x, y, bw, bh])  # リストにして後で変更可能に

    # Y座標でソート
    regions.sort(key=lambda r: r[1])

    # 重なりをマージ
    regions = merge_regions(regions, overlap_threshold=30)

    # 各領域にラベル（上）とキャプション（下）を含める
    extended_regions = []

    for i, (x, y, bw, bh) in enumerate(regions):
        # === 上端の拡張（A, Bラベルを含める）===
        new_top = y

        # 前の境界を探す（前の写真の下端 or ヘッダー）
        prev_boundary = header_end
        if i > 0:
            prev_photo_bottom = regions[i - 1][1] + regions[i - 1][3]
            prev_boundary = max(prev_boundary, prev_photo_bottom)

        # 現在の上端から上方向にラベルを探す
        for check_y in range(y - 1, max(prev_boundary, y - 100), -1):
            row = gray[check_y, :]
            non_white = row < 240
            non_white_indices = np.where(non_white)[0]

            if len(non_white_indices) > 0:
                content_width = non_white_indices[-1] - non_white_indices[0]
                content_center = (non_white_indices[0] + non_white_indices[-1]) / 2

                # ラベルらしき行（幅が狭く中央）
                if content_width < w * 0.15 and w * 0.35 < content_center < w * 0.65:
                    new_top = check_y
                elif content_width > w * 0.2:
                    # 前の写真のキャプションに到達したら停止
                    break

        # 少し余白を追加
        new_top = max(new_top - 10, prev_boundary + 5)

        # === 下端の拡張（キャプションを含める）===
        bottom = y + bh

        # 次の境界を探す
        next_boundary = footer_start
        if i + 1 < len(regions):
            next_photo_top = regions[i + 1][1]
            next_boundary = min(next_boundary, next_photo_top)

        # 次のラベルブロックがあれば、その上端
        for block_start, block_end in label_blocks:
            if block_start > bottom:
                next_boundary = min(next_boundary, block_start - 5)
                break

        new_bottom = bottom

        # キャプションを探す
        for check_y in range(bottom, min(next_boundary, bottom + 150)):
            row = gray[check_y, :]
            non_white = row < 240
            non_white_indices = np.where(non_white)[0]

            if len(non_white_indices) > 0:
                content_width = non_white_indices[-1] - non_white_indices[0]
                if w * 0.05 < content_width < w * 0.5:
                    new_bottom = check_y + 1

        new_bottom = min(new_bottom + 20, next_boundary - 10)

        extended_regions.append((x, new_top, bw, new_bottom - new_top))

    return extended_regions


def merge_regions(regions, overlap_threshold=30):
    """重なっている領域をマージ"""
    if len(regions) <= 1:
        return regions

    merged = []
    current = list(regions[0])

    for x, y, w, h in regions[1:]:
        cx, cy, cw, ch = current

        if y < cy + ch + overlap_threshold:
            new_x = min(cx, x)
            new_y = min(cy, y)
            new_x2 = max(cx + cw, x + w)
            new_y2 = max(cy + ch, y + h)
            current = [new_x, new_y, new_x2 - new_x, new_y2 - new_y]
        else:
            merged.append(current)
            current = [x, y, w, h]

    merged.append(current)
    return merged


def extract_images_for_kai(kai, dry_run=False):
    print(f"\n{'='*50}")
    print(f"第{kai}回 画像抽出 (v6 - キャプション含む)")
    print(f"{'='*50}")

    mapping = get_bessatsu_mapping(kai)
    print(f"別冊参照あり: {len(mapping)}問")

    if not mapping:
        return 0, 0

    bessatsu_dir = KAKOMON_DIR / f"{kai}回" / "別冊"
    if not bessatsu_dir.exists():
        print(f"別冊フォルダなし")
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

                regions = detect_photos_with_captions(img_cv)

                num_expected = len(labels)

                if len(regions) == 0:
                    print(f"  [{code}] 領域検出失敗")
                    skipped += num_expected
                    continue

                if len(regions) < num_expected:
                    print(f"  [{code}] 検出{len(regions)}個 < 期待{num_expected}個")
                    num_to_process = len(regions)
                elif len(regions) > num_expected:
                    print(f"  [{code}] 検出{len(regions)}個 > 期待{num_expected}個")
                    regions = regions[:num_expected]
                    num_to_process = num_expected
                else:
                    num_to_process = num_expected

                for i in range(num_to_process):
                    x, y, bw, bh = regions[i]

                    margin = 5
                    x1 = max(0, x - margin)
                    y1 = max(0, y - margin)
                    x2 = min(img_pil.width, x + bw + margin)
                    y2 = min(img_pil.height, y + bh + margin)

                    cropped = img_pil.crop((x1, y1, x2, y2))

                    if cropped.width < 100 or cropped.height < 100:
                        print(f"  [{code}] サイズ不足: {cropped.size}")
                        skipped += 1
                        continue

                    if num_to_process == 1 and labels[0] is None:
                        output_path = output_dir / f"{code}.png"
                    else:
                        output_path = output_dir / f"{code}_{i+1}.png"

                    if dry_run:
                        print(f"  [{code}] → {output_path.name} {cropped.size}")
                    else:
                        cropped.save(output_path)
                        print(f"  [{code}] → {output_path.name} {cropped.size}")
                    processed += 1

                skipped += max(0, num_expected - num_to_process)

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
        print("python extract_hires_images_v6.py 118")


if __name__ == "__main__":
    main()
