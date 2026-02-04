#!/usr/bin/env python3
"""
高解像度別冊画像から個別写真を切り抜くスクリプト v2

改善点:
- A/B/Cラベルの間の白い区切り線を検出して分割
- 各写真を正確に切り出し
"""

import csv
import os
import re
from pathlib import Path
from PIL import Image
import numpy as np
from collections import defaultdict

# パス設定
BASE_DIR = Path("/Users/saitouryuuichi/Desktop/国試データベース")
KAKOMON_DIR = BASE_DIR / "国家試験過去問"
OUTPUT_DIR = BASE_DIR / "画像_高解像度"
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


def find_horizontal_separators(img_array, white_threshold=245, min_gap_height=20):
    """画像内の水平方向の白い区切り線を検出

    Returns:
        list of (y_start, y_end) for each separator
    """
    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    h, w = gray.shape

    # 各行の白さ（白いピクセルの割合）を計算
    row_whiteness = np.mean(gray > white_threshold, axis=1)

    # 白い行（95%以上が白）を検出
    white_rows = row_whiteness > 0.95

    # 連続する白い行のグループを検出
    separators = []
    in_separator = False
    sep_start = 0

    for i in range(h):
        if white_rows[i] and not in_separator:
            in_separator = True
            sep_start = i
        elif not white_rows[i] and in_separator:
            in_separator = False
            if i - sep_start >= min_gap_height:
                separators.append((sep_start, i))

    # 最後のセパレータ
    if in_separator and h - sep_start >= min_gap_height:
        separators.append((sep_start, h))

    return separators


def find_content_regions_v2(img_array, num_expected, white_threshold=245):
    """画像内のコンテンツ領域を検出（改良版）

    水平方向の白い区切りを検出して、写真領域を分離
    """
    h, w = img_array.shape[:2]

    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    # 上部ヘッダー（No. XX）を除外 - 上から10%
    header_end = int(h * 0.10)
    # 下部フッター（ページ番号）を除外 - 下から3%
    footer_start = int(h * 0.97)

    # 水平セパレータを検出
    separators = find_horizontal_separators(img_array, white_threshold, min_gap_height=30)

    # ヘッダー内のセパレータを除外
    separators = [(s, e) for s, e in separators if s > header_end * 0.5]

    if num_expected == 1:
        # 単一画像：全体を切り出し
        # コンテンツのある行を検出
        row_has_content = np.mean(gray < white_threshold, axis=1) > 0.05
        content_rows = np.where(row_has_content)[0]

        if len(content_rows) == 0:
            return [(0, header_end, w, footer_start)]

        y1 = max(header_end, content_rows[0] - 10)
        y2 = min(footer_start, content_rows[-1] + 10)

        # 左右の余白も検出
        col_has_content = np.mean(gray < white_threshold, axis=0) > 0.05
        content_cols = np.where(col_has_content)[0]

        if len(content_cols) > 0:
            x1 = max(0, content_cols[0] - 10)
            x2 = min(w, content_cols[-1] + 10)
        else:
            x1, x2 = 0, w

        return [(x1, y1, x2, y2)]

    # 複数画像の場合
    # セパレータ間の領域をコンテンツ領域として抽出
    regions = []

    # ヘッダー後から最初のセパレータまで、または最初のコンテンツ
    prev_end = header_end

    for sep_start, sep_end in separators:
        if sep_start > prev_end + 50:  # 十分な高さがある場合のみ
            # この領域内でコンテンツを検出
            region_gray = gray[prev_end:sep_start, :]
            row_has_content = np.mean(region_gray < white_threshold, axis=1) > 0.05
            content_rows = np.where(row_has_content)[0]

            if len(content_rows) > 0:
                y1 = prev_end + content_rows[0]
                y2 = prev_end + content_rows[-1]

                # 左右
                col_has_content = np.mean(gray[y1:y2, :] < white_threshold, axis=0) > 0.05
                content_cols = np.where(col_has_content)[0]

                if len(content_cols) > 0:
                    x1 = max(0, content_cols[0] - 5)
                    x2 = min(w, content_cols[-1] + 5)
                    regions.append((x1, y1, x2, y2))

        prev_end = sep_end

    # 最後のセパレータからフッターまで
    if prev_end < footer_start - 50:
        region_gray = gray[prev_end:footer_start, :]
        row_has_content = np.mean(region_gray < white_threshold, axis=1) > 0.05
        content_rows = np.where(row_has_content)[0]

        if len(content_rows) > 0:
            y1 = prev_end + content_rows[0]
            y2 = prev_end + content_rows[-1]

            col_has_content = np.mean(gray[y1:y2, :] < white_threshold, axis=0) > 0.05
            content_cols = np.where(col_has_content)[0]

            if len(content_cols) > 0:
                x1 = max(0, content_cols[0] - 5)
                x2 = min(w, content_cols[-1] + 5)
                regions.append((x1, y1, x2, y2))

    # 期待される数と一致しない場合、均等分割にフォールバック
    if len(regions) != num_expected:
        print(f"    [警告] 検出領域数({len(regions)}) != 期待数({num_expected}), 均等分割")

        # コンテンツ全体の範囲を取得
        all_content = gray[header_end:footer_start, :]
        row_has_content = np.mean(all_content < white_threshold, axis=1) > 0.02
        content_rows = np.where(row_has_content)[0]

        if len(content_rows) == 0:
            return []

        content_top = header_end + content_rows[0]
        content_bottom = header_end + content_rows[-1]
        content_height = content_bottom - content_top

        col_has_content = np.mean(gray[content_top:content_bottom, :] < white_threshold, axis=0) > 0.02
        content_cols = np.where(col_has_content)[0]
        x1 = content_cols[0] if len(content_cols) > 0 else 0
        x2 = content_cols[-1] if len(content_cols) > 0 else w

        # 均等分割
        regions = []
        part_height = content_height // num_expected
        for i in range(num_expected):
            y1 = content_top + i * part_height
            y2 = content_top + (i + 1) * part_height if i < num_expected - 1 else content_bottom
            regions.append((x1, y1, x2, y2))

    return regions


def extract_single_photo(img, region, margin=5):
    """領域から写真を切り出し、余白をトリム"""
    x1, y1, x2, y2 = region

    # 領域を切り出し
    cropped = img.crop((x1, y1, x2, y2))

    # 追加のトリミング（白い余白を除去）
    img_array = np.array(cropped)
    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    # 白以外のピクセルを検出
    threshold = 250
    non_white = gray < threshold

    rows = np.any(non_white, axis=1)
    cols = np.any(non_white, axis=0)

    row_indices = np.where(rows)[0]
    col_indices = np.where(cols)[0]

    if len(row_indices) == 0 or len(col_indices) == 0:
        return cropped

    # A/B/Cラベルを除去（上部の小さなテキスト領域）
    # 最初の数行がラベルの可能性が高い
    label_check_height = min(50, len(row_indices) // 10)
    if label_check_height > 0:
        top_region = non_white[:label_check_height, :]
        # ラベル部分は幅が狭い（中央に小さな文字）
        if np.sum(top_region) < cropped.width * label_check_height * 0.1:
            # ラベル部分をスキップ
            for i, has_content in enumerate(rows):
                if has_content:
                    # この行のコンテンツ幅をチェック
                    row_content = non_white[i, :]
                    content_width = np.sum(row_content)
                    if content_width > cropped.width * 0.3:  # 幅の30%以上なら写真本体
                        row_indices = row_indices[row_indices >= i]
                        break

    if len(row_indices) == 0:
        return cropped

    y1_new = max(0, row_indices[0] - margin)
    y2_new = min(cropped.height, row_indices[-1] + margin)
    x1_new = max(0, col_indices[0] - margin)
    x2_new = min(cropped.width, col_indices[-1] + margin)

    return cropped.crop((x1_new, y1_new, x2_new, y2_new))


def extract_images_for_kai(kai, dry_run=False):
    """指定回次の画像を抽出"""
    print(f"\n{'='*50}")
    print(f"第{kai}回 画像抽出 (v2)")
    print(f"{'='*50}")

    mapping = get_bessatsu_mapping(kai)
    print(f"別冊参照あり: {len(mapping)}問")

    if not mapping:
        print("別冊参照がありません")
        return 0, 0

    bessatsu_dir = KAKOMON_DIR / f"{kai}回" / "別冊"
    if not bessatsu_dir.exists():
        print(f"別冊フォルダが見つかりません: {bessatsu_dir}")
        return 0, 0

    output_dir = OUTPUT_DIR / f"{kai}回_Web画像"
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
            # ページごとにグループ化
            by_page = defaultdict(list)
            for page, label in refs:
                by_page[page].append(label)

            for page_num, labels in by_page.items():
                bessatsu_file = bessatsu_dir / f"{kai}{section}_別冊{page_num:02d}.png"
                if not bessatsu_file.exists():
                    print(f"  [{code}] 別冊{page_num:02d} が見つかりません")
                    skipped += 1
                    continue

                img = Image.open(bessatsu_file)
                img_array = np.array(img)

                num_images = len(labels)

                # コンテンツ領域を検出
                regions = find_content_regions_v2(img_array, num_images)

                if len(regions) == 0:
                    print(f"  [{code}] コンテンツ検出失敗")
                    skipped += 1
                    continue

                # 領域数を調整
                if len(regions) > num_images:
                    regions = regions[:num_images]
                elif len(regions) < num_images:
                    print(f"  [{code}] 領域不足 ({len(regions)}/{num_images})")

                for i, (label, region) in enumerate(zip(labels, regions)):
                    cropped_img = extract_single_photo(img, region)

                    # 最小サイズチェック
                    if cropped_img.width < 50 or cropped_img.height < 50:
                        print(f"  [{code}] 画像が小さすぎます: {cropped_img.size}")
                        skipped += 1
                        continue

                    # ファイル名
                    if num_images == 1 and labels[0] is None:
                        output_path = output_dir / f"{code}.png"
                    else:
                        suffix = i + 1
                        output_path = output_dir / f"{code}_{suffix}.png"

                    if dry_run:
                        print(f"  [{code}] 別冊{page_num:02d}{label or ''} → {output_path.name} {cropped_img.size}")
                    else:
                        cropped_img.save(output_path, quality=95)
                        print(f"  [{code}] → {output_path.name} {cropped_img.size}")
                    processed += 1

    print(f"\n処理完了: {processed}枚生成、{skipped}枚スキップ")
    print(f"出力先: {output_dir}")

    return processed, skipped


def main():
    import argparse

    parser = argparse.ArgumentParser(description='高解像度別冊画像から個別写真を切り抜き v2')
    parser.add_argument('kai', type=int, nargs='?', help='対象回次')
    parser.add_argument('--dry-run', action='store_true', help='テスト実行')
    parser.add_argument('--all', action='store_true', help='102〜117回すべて')

    args = parser.parse_args()

    if args.all:
        total_processed = 0
        total_skipped = 0
        for kai in range(102, 118):
            p, s = extract_images_for_kai(kai, dry_run=args.dry_run)
            total_processed += p
            total_skipped += s
        print(f"\n{'='*50}")
        print(f"全回次合計: {total_processed}枚生成、{total_skipped}枚スキップ")
    elif args.kai:
        extract_images_for_kai(args.kai, dry_run=args.dry_run)
    else:
        print("使用方法:")
        print("  python extract_hires_images_v2.py 118        # 118回のみ")
        print("  python extract_hires_images_v2.py --all      # 全回次")
        print("  python extract_hires_images_v2.py 118 --dry-run  # テスト")


if __name__ == "__main__":
    main()
