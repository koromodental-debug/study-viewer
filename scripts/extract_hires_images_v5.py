#!/usr/bin/env python3
"""
高解像度別冊画像から個別写真を切り抜くスクリプト v5

OpenCVの輪郭検出で写真領域を自動検出
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
    """別冊参照文字列をパース"""
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
    """指定回次の別冊参照マッピングを取得"""
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
    """白紙ページかどうか判定"""
    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array
    white_ratio = np.mean(gray > white_threshold)
    return white_ratio > 0.95


def detect_photo_regions(img_array, min_area_ratio=0.01):
    """OpenCVで写真領域を自動検出

    Returns:
        list of (x, y, w, h) bounding boxes, sorted by y position
    """
    h, w = img_array.shape[:2]
    min_area = h * w * min_area_ratio  # 全体の1%以上の面積

    # グレースケール変換
    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array

    # ヘッダー（上部10%）とフッター（下部5%）をマスク
    header_end = int(h * 0.08)
    footer_start = int(h * 0.96)

    # 二値化（白い背景を除去）
    # 適応的閾値を使用
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 21, 10
    )

    # ヘッダー/フッターをマスク
    binary[:header_end, :] = 0
    binary[footer_start:, :] = 0

    # モルフォロジー処理でノイズ除去と領域統合
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=3)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=2)

    # さらに大きなカーネルで領域を統合
    kernel_large = cv2.getStructuringElement(cv2.MORPH_RECT, (20, 20))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel_large, iterations=2)

    # 輪郭検出
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # 大きな輪郭のみ抽出
    regions = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area > min_area:
            x, y, bw, bh = cv2.boundingRect(contour)
            # 小さすぎる領域は除外
            if bw > w * 0.1 and bh > h * 0.05:
                regions.append((x, y, bw, bh))

    # Y座標でソート（上から順）
    regions.sort(key=lambda r: r[1])

    return regions


def merge_overlapping_regions(regions, overlap_threshold=50):
    """重なっている領域をマージ"""
    if len(regions) <= 1:
        return regions

    merged = []
    current = list(regions[0])

    for x, y, w, h in regions[1:]:
        cx, cy, cw, ch = current

        # 現在の領域と重なっているか、近接しているか
        if y < cy + ch + overlap_threshold:
            # マージ
            new_x = min(cx, x)
            new_y = min(cy, y)
            new_x2 = max(cx + cw, x + w)
            new_y2 = max(cy + ch, y + h)
            current = [new_x, new_y, new_x2 - new_x, new_y2 - new_y]
        else:
            merged.append(tuple(current))
            current = [x, y, w, h]

    merged.append(tuple(current))
    return merged


def detect_photos_by_color(img_array, min_area_ratio=0.02):
    """色情報を使って写真領域を検出（白背景との差分）"""
    h, w = img_array.shape[:2]
    min_area = h * w * min_area_ratio

    # グレースケール
    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array

    # ヘッダー/フッター除外
    header_end = int(h * 0.08)
    footer_start = int(h * 0.96)

    # 白以外の領域を検出（閾値240以下）
    _, binary = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)

    # ヘッダー/フッターをマスク
    binary[:header_end, :] = 0
    binary[footer_start:, :] = 0

    # 中央付近の細い領域（A, B, Cラベル）を除去
    # 各行について、コンテンツ幅が狭く中央にある場合は除去
    for y in range(header_end, footer_start):
        row = binary[y, :]
        non_zero = np.where(row > 0)[0]
        if len(non_zero) > 0:
            content_width = non_zero[-1] - non_zero[0]
            content_center = (non_zero[0] + non_zero[-1]) / 2
            # 幅が狭く（15%以下）、中央にある場合はラベル
            if content_width < w * 0.15 and w * 0.35 < content_center < w * 0.65:
                binary[y, :] = 0

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
                regions.append((x, y, bw, bh))

    regions.sort(key=lambda r: r[1])

    # 重なりをマージ
    regions = merge_overlapping_regions(regions)

    return regions


def extract_images_for_kai(kai, dry_run=False):
    """指定回次の画像を抽出"""
    print(f"\n{'='*50}")
    print(f"第{kai}回 画像抽出 (v5 - OpenCV)")
    print(f"{'='*50}")

    mapping = get_bessatsu_mapping(kai)
    print(f"別冊参照あり: {len(mapping)}問")

    if not mapping:
        return 0, 0

    bessatsu_dir = KAKOMON_DIR / f"{kai}回" / "別冊"
    if not bessatsu_dir.exists():
        print(f"別冊フォルダなし: {bessatsu_dir}")
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

                # OpenCVで読み込み
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

                # 写真領域を検出
                regions = detect_photos_by_color(img_cv)

                num_expected = len(labels)

                if len(regions) == 0:
                    print(f"  [{code}] 領域検出失敗")
                    skipped += num_expected
                    continue

                # 検出数と期待数の調整
                if len(regions) < num_expected:
                    print(f"  [{code}] 検出{len(regions)}個 < 期待{num_expected}個")
                    # 検出された分だけ処理
                    num_to_process = len(regions)
                elif len(regions) > num_expected:
                    print(f"  [{code}] 検出{len(regions)}個 > 期待{num_expected}個、上位{num_expected}個を使用")
                    regions = regions[:num_expected]
                    num_to_process = num_expected
                else:
                    num_to_process = num_expected

                for i in range(num_to_process):
                    x, y, bw, bh = regions[i]

                    # 少し余白を追加
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

                # 期待数より少ない場合
                skipped += max(0, num_expected - num_to_process)

    print(f"\n処理完了: {processed}枚、スキップ: {skipped}枚")
    print(f"出力先: {output_dir}")

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
        print("python extract_hires_images_v5.py 118")


if __name__ == "__main__":
    main()
