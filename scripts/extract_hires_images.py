#!/usr/bin/env python3
"""
高解像度別冊画像から個別写真を切り抜くスクリプト

入力: 国家試験過去問/{回次}回/別冊/*.png
出力: 画像_高解像度/{回次}回_Web画像/{問題コード}_1.png, _2.png, ...

処理フロー:
1. all_questions.csv から別冊参照マッピングを取得
2. 別冊画像を読み込み
3. 画像内の写真領域を自動検出
4. 複数写真がある場合は分割して切り抜き
5. 問題コード_1.png, _2.png として保存
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
    """別冊参照文字列をパース

    例:
    "1" → [(1, None)]
    "4A, 4B" → [(4, 'A'), (4, 'B')]
    "5A, 5B, 5C" → [(5, 'A'), (5, 'B'), (5, 'C')]
    """
    if not ref_str:
        return []

    results = []
    parts = [p.strip() for p in ref_str.split(',')]

    for part in parts:
        # "4A" or "4" のパターンをマッチ
        match = re.match(r'^(\d+)([A-Z])?$', part.strip())
        if match:
            page = int(match.group(1))
            label = match.group(2)  # None or 'A', 'B', ...
            results.append((page, label))

    return results


def get_bessatsu_mapping(kai):
    """指定回次の別冊参照マッピングを取得"""
    mapping = {}  # {問題コード: [(page, label), ...]}

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


def find_content_regions(img_array, threshold=240, min_area=5000):
    """画像内のコンテンツ領域（非白領域）を検出

    Returns:
        list of (x1, y1, x2, y2) bounding boxes
    """
    # グレースケール変換
    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    # 二値化（白以外を検出）
    binary = gray < threshold

    # 上部のヘッダー領域を除外（No. XX の部分）
    h, w = binary.shape
    header_height = int(h * 0.08)  # 上部8%を除外
    footer_height = int(h * 0.03)  # 下部3%を除外（ページ番号）

    binary[:header_height, :] = False
    binary[-footer_height:, :] = False

    # 連結成分を検出（簡易版：列方向の投影で分割）
    col_projection = np.sum(binary, axis=0)
    row_projection = np.sum(binary, axis=1)

    # コンテンツがある列範囲を検出
    col_threshold = h * 0.02
    content_cols = col_projection > col_threshold

    # コンテンツがある行範囲を検出
    row_threshold = w * 0.02
    content_rows = row_projection > row_threshold

    # 全体のバウンディングボックス
    col_indices = np.where(content_cols)[0]
    row_indices = np.where(content_rows)[0]

    if len(col_indices) == 0 or len(row_indices) == 0:
        return []

    x1 = col_indices[0]
    x2 = col_indices[-1]
    y1 = row_indices[0]
    y2 = row_indices[-1]

    return [(x1, y1, x2, y2)]


def split_image_regions(img_array, num_parts, threshold=240):
    """画像を指定された数の領域に分割

    num_parts: 分割数（2=A,B、3=A,B,C、4=A,B,C,D）
    """
    h, w = img_array.shape[:2]

    # グレースケール変換
    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    # ヘッダー/フッター除外
    header_height = int(h * 0.08)
    footer_height = int(h * 0.03)

    # コンテンツ領域の検出
    binary = gray < threshold
    binary[:header_height, :] = False
    binary[-footer_height:, :] = False

    # 行投影で水平分割ポイントを検出
    row_projection = np.sum(binary, axis=1)

    # 分割の方向を決定（横並びか縦並びか）
    col_projection = np.sum(binary, axis=0)

    # コンテンツの範囲を取得
    row_indices = np.where(row_projection > w * 0.01)[0]
    col_indices = np.where(col_projection > h * 0.01)[0]

    if len(row_indices) == 0 or len(col_indices) == 0:
        return []

    content_top = row_indices[0]
    content_bottom = row_indices[-1]
    content_left = col_indices[0]
    content_right = col_indices[-1]

    content_h = content_bottom - content_top
    content_w = content_right - content_left

    regions = []

    if num_parts == 1:
        # 単一画像
        regions.append((content_left, content_top, content_right, content_bottom))

    elif num_parts == 2:
        # 2分割：横並びか縦並びか判定
        # 中央付近の空白を検出
        mid_col = w // 2
        mid_row = h // 2

        # 縦方向の中央付近の空白をチェック
        vertical_gap = np.sum(binary[content_top:content_bottom, mid_col-50:mid_col+50])
        # 横方向の中央付近の空白をチェック
        horizontal_gap = np.sum(binary[mid_row-50:mid_row+50, content_left:content_right])

        if content_w > content_h * 1.5:
            # 横長なので横に並んでいる可能性が高い
            # 中央で分割
            regions.append((content_left, content_top, mid_col - 20, content_bottom))
            regions.append((mid_col + 20, content_top, content_right, content_bottom))
        else:
            # 縦に並んでいる
            regions.append((content_left, content_top, content_right, mid_row - 20))
            regions.append((content_left, mid_row + 20, content_right, content_bottom))

    elif num_parts == 3:
        # 3分割：通常は縦に3つ
        third_h = content_h // 3
        for i in range(3):
            top = content_top + i * third_h
            bottom = content_top + (i + 1) * third_h if i < 2 else content_bottom
            regions.append((content_left, top, content_right, bottom))

    elif num_parts >= 4:
        # 4分割以上：2x2グリッドなど
        mid_col = (content_left + content_right) // 2
        mid_row = (content_top + content_bottom) // 2

        regions.append((content_left, content_top, mid_col - 10, mid_row - 10))
        regions.append((mid_col + 10, content_top, content_right, mid_row - 10))
        regions.append((content_left, mid_row + 10, mid_col - 10, content_bottom))
        regions.append((mid_col + 10, mid_row + 10, content_right, content_bottom))

    return regions[:num_parts]


def auto_crop(img, margin=10):
    """画像の余白を自動トリミング"""
    img_array = np.array(img)

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
        return img

    y1 = max(0, row_indices[0] - margin)
    y2 = min(img.height, row_indices[-1] + margin)
    x1 = max(0, col_indices[0] - margin)
    x2 = min(img.width, col_indices[-1] + margin)

    return img.crop((x1, y1, x2, y2))


def extract_images_for_kai(kai, dry_run=False):
    """指定回次の画像を抽出"""
    print(f"\n{'='*50}")
    print(f"第{kai}回 画像抽出")
    print(f"{'='*50}")

    # 別冊参照マッピングを取得
    mapping = get_bessatsu_mapping(kai)
    print(f"別冊参照あり: {len(mapping)}問")

    if not mapping:
        print("別冊参照がありません")
        return

    # 別冊フォルダ
    bessatsu_dir = KAKOMON_DIR / f"{kai}回" / "別冊"
    if not bessatsu_dir.exists():
        print(f"別冊フォルダが見つかりません: {bessatsu_dir}")
        return

    # 出力フォルダ
    output_dir = OUTPUT_DIR / f"{kai}回_Web画像"
    if not dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    # 区分ごとにグループ化
    by_section = defaultdict(list)
    for code, refs in mapping.items():
        section = code[3]  # A, B, C, D
        by_section[section].append((code, refs))

    processed = 0
    skipped = 0

    for section in ['A', 'B', 'C', 'D']:
        if section not in by_section:
            continue

        print(f"\n--- {kai}{section} ---")

        for code, refs in by_section[section]:
            # 別冊ページ番号を取得
            page_nums = set(r[0] for r in refs)
            labels = [r[1] for r in refs]

            for page_num in page_nums:
                # 別冊画像を読み込み
                bessatsu_file = bessatsu_dir / f"{kai}{section}_別冊{page_num:02d}.png"
                if not bessatsu_file.exists():
                    print(f"  [{code}] 別冊{page_num:02d} が見つかりません")
                    skipped += 1
                    continue

                img = Image.open(bessatsu_file)
                img_array = np.array(img)

                # このページの参照ラベルを取得
                page_labels = [r[1] for r in refs if r[0] == page_num]
                num_images = len(page_labels)

                if num_images == 1 and page_labels[0] is None:
                    # 単一画像
                    cropped = auto_crop(img)
                    output_path = output_dir / f"{code}.png"

                    if dry_run:
                        print(f"  [{code}] 別冊{page_num:02d} → {output_path.name} ({cropped.size})")
                    else:
                        cropped.save(output_path, quality=95)
                        print(f"  [{code}] 別冊{page_num:02d} → {output_path.name}")
                    processed += 1

                else:
                    # 複数画像を分割
                    regions = split_image_regions(img_array, num_images)

                    if len(regions) < num_images:
                        print(f"  [{code}] 領域分割失敗 ({num_images}個必要、{len(regions)}個検出)")
                        # フォールバック：均等分割
                        h, w = img_array.shape[:2]
                        if num_images == 2:
                            regions = [(0, 0, w, h//2), (0, h//2, w, h)]
                        elif num_images == 3:
                            regions = [(0, 0, w, h//3), (0, h//3, w, 2*h//3), (0, 2*h//3, w, h)]

                    for i, (label, region) in enumerate(zip(page_labels, regions)):
                        x1, y1, x2, y2 = region
                        cropped_img = img.crop((x1, y1, x2, y2))
                        cropped_img = auto_crop(cropped_img)

                        # ファイル名: {code}_1.png, {code}_2.png, ...
                        suffix = i + 1
                        output_path = output_dir / f"{code}_{suffix}.png"

                        if dry_run:
                            print(f"  [{code}] 別冊{page_num:02d}{label or ''} → {output_path.name} ({cropped_img.size})")
                        else:
                            cropped_img.save(output_path, quality=95)
                            print(f"  [{code}] 別冊{page_num:02d}{label or ''} → {output_path.name}")
                        processed += 1

    print(f"\n処理完了: {processed}枚生成、{skipped}枚スキップ")
    print(f"出力先: {output_dir}")

    return processed, skipped


def main():
    import argparse

    parser = argparse.ArgumentParser(description='高解像度別冊画像から個別写真を切り抜き')
    parser.add_argument('kai', type=int, nargs='?', help='対象回次（省略時は全回次）')
    parser.add_argument('--dry-run', action='store_true', help='実際には保存せず処理内容を表示')
    parser.add_argument('--all', action='store_true', help='102回〜117回すべてを処理')

    args = parser.parse_args()

    if args.all:
        for kai in range(102, 118):
            extract_images_for_kai(kai, dry_run=args.dry_run)
    elif args.kai:
        extract_images_for_kai(args.kai, dry_run=args.dry_run)
    else:
        print("使用方法:")
        print("  python extract_hires_images.py 102        # 102回のみ")
        print("  python extract_hires_images.py --all      # 全回次")
        print("  python extract_hires_images.py 102 --dry-run  # テスト実行")


if __name__ == "__main__":
    main()
