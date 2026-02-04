#!/usr/bin/env python3
"""
高解像度別冊画像から個別写真を切り抜くスクリプト v3

パターン認識方式:
1. 白紙ページ → スキップ
2. 単一画像（ラベルなし）→ 全体を切り出し
3. A/B/C分離 → ラベルごとに分割して切り出し
4. 複数写真で1ラベル → ラベル下全体を1画像として切り出し

ラベル検出: 「A」「B」「C」などの単独大文字を検出して分割
"""

import csv
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


def is_blank_page(img_array, white_threshold=250):
    """白紙ページかどうか判定"""
    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    # 95%以上が白なら白紙
    white_ratio = np.mean(gray > white_threshold)
    return white_ratio > 0.95


def detect_label_positions(img_array, white_threshold=245):
    """「A」「B」「C」などのラベル位置を検出

    Returns:
        list of (label_char, y_position) sorted by y_position
    """
    h, w = img_array.shape[:2]

    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    # 各行について分析
    # ラベル行の特徴：
    # - 白い背景（大部分が白）
    # - 中央付近に小さな黒い部分（文字）
    # - 文字の幅は狭い（全体の5%以下）

    labels = []

    # ヘッダー（No. XX）をスキップするため、上部15%から開始
    start_row = int(h * 0.12)
    # フッター（ページ番号）をスキップするため、下部5%を除外
    end_row = int(h * 0.95)

    # 行ごとにスキャン
    i = start_row
    while i < end_row:
        row = gray[i, :]

        # この行の白さ
        row_whiteness = np.mean(row > white_threshold)

        # 非白ピクセルの位置
        non_white = row < white_threshold
        non_white_indices = np.where(non_white)[0]

        if row_whiteness > 0.90 and len(non_white_indices) > 0:
            # ほぼ白い行で、何かコンテンツがある

            # コンテンツの幅
            content_width = non_white_indices[-1] - non_white_indices[0] if len(non_white_indices) > 1 else 0
            content_center = (non_white_indices[0] + non_white_indices[-1]) / 2 if len(non_white_indices) > 1 else w/2

            # ラベルの条件：
            # - 幅が狭い（全体の10%以下）
            # - 中央付近にある（30%〜70%の範囲）
            # - 上下数行も似たような特徴（文字の縦幅）

            if content_width < w * 0.10 and w * 0.30 < content_center < w * 0.70:
                # 上下5行をチェックして、ラベルブロックの範囲を確定
                label_height = 0
                for j in range(i, min(i + 60, end_row)):
                    row_j = gray[j, :]
                    row_j_whiteness = np.mean(row_j > white_threshold)
                    non_white_j = np.where(row_j < white_threshold)[0]

                    if len(non_white_j) > 0:
                        cw = non_white_j[-1] - non_white_j[0]
                        cc = (non_white_j[0] + non_white_j[-1]) / 2
                        if cw < w * 0.15 and w * 0.25 < cc < w * 0.75:
                            label_height += 1
                        else:
                            break
                    elif row_j_whiteness > 0.98:
                        # 完全に白い行
                        if label_height > 10:
                            break
                        label_height += 1
                    else:
                        break

                # ラベルの高さが20〜80pxくらいなら有効
                if 15 < label_height < 100:
                    # このラベルの中心Y座標
                    label_y = i + label_height // 2
                    labels.append(('?', label_y, i, i + label_height))
                    # このラベルブロックをスキップ
                    i += label_height
                    continue

        i += 1

    return labels


def find_content_boundaries(img_array, white_threshold=245):
    """画像全体のコンテンツ境界を検出"""
    h, w = img_array.shape[:2]

    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    # 行ごとのコンテンツ存在チェック
    row_has_content = np.mean(gray < white_threshold, axis=1) > 0.02
    col_has_content = np.mean(gray < white_threshold, axis=0) > 0.02

    content_rows = np.where(row_has_content)[0]
    content_cols = np.where(col_has_content)[0]

    if len(content_rows) == 0 or len(content_cols) == 0:
        return None

    # ヘッダー（No. XX）とフッター（ページ番号）を除外
    # 上から10%、下から5%を除外した範囲でコンテンツを探す
    header_end = int(h * 0.10)
    footer_start = int(h * 0.95)

    # ヘッダー/フッター除外後のコンテンツ行
    valid_rows = content_rows[(content_rows > header_end) & (content_rows < footer_start)]

    if len(valid_rows) == 0:
        return None

    y1 = valid_rows[0]
    y2 = valid_rows[-1]
    x1 = content_cols[0]
    x2 = content_cols[-1]

    return (x1, y1, x2, y2)


def split_by_labels(img_array, num_labels, white_threshold=245):
    """ラベル数に基づいて画像を分割

    白い水平帯を検出して分割点を決定
    """
    h, w = img_array.shape[:2]

    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    # ヘッダー/フッター除外
    header_end = int(h * 0.10)
    footer_start = int(h * 0.95)

    # コンテンツ境界
    bounds = find_content_boundaries(img_array, white_threshold)
    if bounds is None:
        return []

    x1, y1, x2, y2 = bounds

    if num_labels == 1:
        return [(x1, y1, x2, y2)]

    # 行ごとの「白さ」を計算
    row_whiteness = np.mean(gray > white_threshold, axis=1)

    # 白い水平帯（区切り）を検出
    # 条件：95%以上が白、かつ連続して30行以上
    separators = []
    in_white = False
    white_start = 0

    for i in range(y1, y2):
        if row_whiteness[i] > 0.95:
            if not in_white:
                in_white = True
                white_start = i
        else:
            if in_white:
                in_white = False
                white_len = i - white_start
                if white_len > 30:  # 30行以上の白い帯
                    separators.append((white_start, i))

    # 最後の白い帯
    if in_white:
        white_len = y2 - white_start
        if white_len > 30:
            separators.append((white_start, y2))

    # 区切りが見つからない場合は均等分割
    if len(separators) < num_labels - 1:
        # 均等分割
        content_height = y2 - y1
        part_height = content_height // num_labels
        regions = []
        for i in range(num_labels):
            py1 = y1 + i * part_height
            py2 = y1 + (i + 1) * part_height if i < num_labels - 1 else y2
            regions.append((x1, py1, x2, py2))
        return regions

    # 区切りに基づいて分割
    regions = []
    prev_end = y1

    for sep_start, sep_end in separators[:num_labels-1]:
        if sep_start > prev_end:
            regions.append((x1, prev_end, x2, sep_start))
        prev_end = sep_end

    # 最後の領域
    if prev_end < y2:
        regions.append((x1, prev_end, x2, y2))

    return regions[:num_labels]


def trim_image(img, margin=5, white_threshold=250):
    """画像の余白をトリム（ラベル文字も除去）"""
    img_array = np.array(img)

    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    h, w = gray.shape

    # 非白ピクセルを検出
    non_white = gray < white_threshold

    rows = np.any(non_white, axis=1)
    cols = np.any(non_white, axis=0)

    row_indices = np.where(rows)[0]
    col_indices = np.where(cols)[0]

    if len(row_indices) == 0 or len(col_indices) == 0:
        return img

    # 上部のラベル（A, B, C）を除去
    # ラベルの特徴：幅が狭く、中央にある
    content_start = row_indices[0]
    for i in range(min(len(row_indices), 80)):
        row_idx = row_indices[i]
        row_non_white = np.where(non_white[row_idx, :])[0]
        if len(row_non_white) > 0:
            content_width = row_non_white[-1] - row_non_white[0]
            content_center = (row_non_white[0] + row_non_white[-1]) / 2

            # ラベルっぽい（幅が狭く中央にある）
            if content_width < w * 0.15 and w * 0.30 < content_center < w * 0.70:
                continue
            else:
                # 写真本体に到達
                content_start = row_idx
                break

    # 有効な行範囲を再計算
    valid_rows = row_indices[row_indices >= content_start]
    if len(valid_rows) == 0:
        valid_rows = row_indices

    y1 = max(0, valid_rows[0] - margin)
    y2 = min(h, valid_rows[-1] + margin)
    x1 = max(0, col_indices[0] - margin)
    x2 = min(w, col_indices[-1] + margin)

    return img.crop((x1, y1, x2, y2))


def extract_images_for_kai(kai, dry_run=False):
    """指定回次の画像を抽出"""
    print(f"\n{'='*50}")
    print(f"第{kai}回 画像抽出 (v3)")
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

    # 区分ごとにグループ化
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
                    print(f"  [{code}] 別冊{page_num:02d} なし")
                    skipped += len(labels)
                    continue

                img = Image.open(bessatsu_file)
                img_array = np.array(img)

                # 白紙チェック
                if is_blank_page(img_array):
                    print(f"  [{code}] 別冊{page_num:02d} 白紙スキップ")
                    skipped += len(labels)
                    continue

                num_images = len(labels)

                # 画像を分割
                regions = split_by_labels(img_array, num_images)

                if len(regions) == 0:
                    print(f"  [{code}] コンテンツなし")
                    skipped += num_images
                    continue

                # 領域数を調整
                while len(regions) < num_images:
                    regions.append(regions[-1])

                for i, (label, region) in enumerate(zip(labels, regions)):
                    x1, y1, x2, y2 = region
                    cropped_img = img.crop((x1, y1, x2, y2))
                    cropped_img = trim_image(cropped_img)

                    # 最小サイズチェック
                    if cropped_img.width < 100 or cropped_img.height < 100:
                        print(f"  [{code}] サイズ不足: {cropped_img.size}")
                        skipped += 1
                        continue

                    # ファイル名
                    if num_images == 1 and labels[0] is None:
                        output_path = output_dir / f"{code}.png"
                    else:
                        suffix = i + 1
                        output_path = output_dir / f"{code}_{suffix}.png"

                    if dry_run:
                        print(f"  [{code}] → {output_path.name} {cropped_img.size}")
                    else:
                        cropped_img.save(output_path, quality=95)
                        print(f"  [{code}] → {output_path.name} {cropped_img.size}")
                    processed += 1

    print(f"\n処理完了: {processed}枚、スキップ: {skipped}枚")
    print(f"出力先: {output_dir}")

    return processed, skipped


def main():
    import argparse

    parser = argparse.ArgumentParser(description='高解像度別冊画像抽出 v3')
    parser.add_argument('kai', type=int, nargs='?', help='対象回次')
    parser.add_argument('--dry-run', action='store_true', help='テスト実行')
    parser.add_argument('--all', action='store_true', help='102〜117回すべて')

    args = parser.parse_args()

    if args.all:
        total_p, total_s = 0, 0
        for kai in range(102, 118):
            p, s = extract_images_for_kai(kai, dry_run=args.dry_run)
            total_p += p
            total_s += s
        print(f"\n{'='*50}")
        print(f"全回次合計: {total_p}枚、スキップ: {total_s}枚")
    elif args.kai:
        extract_images_for_kai(args.kai, dry_run=args.dry_run)
    else:
        print("使用方法:")
        print("  python extract_hires_images_v3.py 118")
        print("  python extract_hires_images_v3.py --all")
        print("  python extract_hires_images_v3.py 118 --dry-run")


if __name__ == "__main__":
    main()
