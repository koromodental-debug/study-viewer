#!/usr/bin/env python3
"""
高解像度別冊画像から個別写真を切り抜くスクリプト v4

修正点:
- 出力先を国家試験過去問/{回次}回/切り抜き/ に変更
- 「A」「B」ラベル間で分割、サブラベル（ア、イ、ウ等）は保持
- ヘッダー（No. XX）とフッター（ページ番号）のみ除去
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
    white_ratio = np.mean(gray > white_threshold)
    return white_ratio > 0.95


def find_ab_separator(img_array, white_threshold=245):
    """「A」と「B」の間の区切り位置を検出

    A/B間の特徴:
    - 白い水平帯がある
    - その中に「B」という単独文字がある
    - 帯の高さは50-150px程度
    """
    h, w = img_array.shape[:2]

    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    # 行ごとの白さ
    row_whiteness = np.mean(gray > white_threshold, axis=1)

    # ヘッダー（上部15%）とフッター（下部5%）を除外
    start_row = int(h * 0.15)
    end_row = int(h * 0.95)

    # 白い水平帯を検出（90%以上白、連続50行以上）
    separators = []
    in_white = False
    white_start = 0

    for i in range(start_row, end_row):
        if row_whiteness[i] > 0.90:
            if not in_white:
                in_white = True
                white_start = i
        else:
            if in_white:
                in_white = False
                white_len = i - white_start
                # 白い帯の長さが50-200pxの場合、A/B間の区切りの可能性
                if 50 < white_len < 200:
                    # この帯の中央付近に「B」などのラベルがあるかチェック
                    mid_y = (white_start + i) // 2
                    # 帯の中のコンテンツ幅をチェック
                    for y in range(white_start + 10, i - 10):
                        row = gray[y, :]
                        non_white = row < white_threshold
                        non_white_indices = np.where(non_white)[0]
                        if len(non_white_indices) > 0:
                            content_width = non_white_indices[-1] - non_white_indices[0]
                            content_center = (non_white_indices[0] + non_white_indices[-1]) / 2
                            # 幅が狭く（<10%）、中央にある場合はラベル
                            if content_width < w * 0.10 and w * 0.35 < content_center < w * 0.65:
                                separators.append((white_start, i, mid_y))
                                break

    return separators


def get_content_bounds(img_array, white_threshold=245, exclude_header=True, exclude_footer=True):
    """コンテンツの境界を取得（ヘッダー/フッターを除外可能）"""
    h, w = img_array.shape[:2]

    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    # コンテンツのある行/列を検出
    row_has_content = np.mean(gray < white_threshold, axis=1) > 0.02
    col_has_content = np.mean(gray < white_threshold, axis=0) > 0.02

    content_rows = np.where(row_has_content)[0]
    content_cols = np.where(col_has_content)[0]

    if len(content_rows) == 0 or len(content_cols) == 0:
        return None

    # ヘッダー/フッター除外
    header_end = int(h * 0.08) if exclude_header else 0
    footer_start = int(h * 0.96) if exclude_footer else h

    valid_rows = content_rows[(content_rows > header_end) & (content_rows < footer_start)]

    if len(valid_rows) == 0:
        return None

    y1 = valid_rows[0]
    y2 = valid_rows[-1]
    x1 = max(0, content_cols[0] - 5)
    x2 = min(w, content_cols[-1] + 5)

    return (x1, y1, x2, y2)


def split_by_ab_labels(img_array, num_labels, white_threshold=245):
    """A/Bラベル間で画像を分割"""
    h, w = img_array.shape[:2]

    # 全体のコンテンツ境界
    bounds = get_content_bounds(img_array, white_threshold)
    if bounds is None:
        return []

    x1, y1, x2, y2 = bounds

    if num_labels == 1:
        return [(x1, y1, x2, y2)]

    # A/B間の区切りを検出
    separators = find_ab_separator(img_array, white_threshold)

    if len(separators) >= num_labels - 1:
        # 区切りに基づいて分割
        regions = []
        prev_y = y1

        for i, (sep_start, sep_end, _) in enumerate(separators[:num_labels-1]):
            # 区切りの上端までを1つの領域とする
            regions.append((x1, prev_y, x2, sep_start))
            prev_y = sep_end

        # 最後の領域
        regions.append((x1, prev_y, x2, y2))
        return regions

    # 区切りが見つからない場合：コンテンツベースで分割を試みる
    if len(img_array.shape) == 3:
        gray = np.mean(img_array, axis=2)
    else:
        gray = img_array

    # 行ごとの白さを計算
    row_whiteness = np.mean(gray > white_threshold, axis=1)

    # y1からy2の間で、白い帯（80%以上白が30行以上続く）を探す
    white_bands = []
    in_white = False
    white_start = 0

    for i in range(y1, y2):
        if row_whiteness[i] > 0.80:
            if not in_white:
                in_white = True
                white_start = i
        else:
            if in_white:
                in_white = False
                if i - white_start > 30:
                    white_bands.append((white_start, i))

    if len(white_bands) >= num_labels - 1:
        regions = []
        prev_y = y1
        for sep_start, sep_end in white_bands[:num_labels-1]:
            regions.append((x1, prev_y, x2, sep_start))
            prev_y = sep_end
        regions.append((x1, prev_y, x2, y2))
        return regions

    # それでもダメなら均等分割
    content_height = y2 - y1
    part_height = content_height // num_labels
    regions = []
    for i in range(num_labels):
        py1 = y1 + i * part_height
        py2 = y1 + (i + 1) * part_height if i < num_labels - 1 else y2
        regions.append((x1, py1, x2, py2))

    return regions


def trim_header_footer_only(img, white_threshold=245):
    """ヘッダー（No. XX）とフッター（ページ番号）のみ除去、サブラベルは保持"""
    img_array = np.array(img)
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
        return img

    # 上部の「A」「B」などの単独ラベルを検出してスキップ
    # ラベルの特徴：幅が狭い（10%以下）、中央にある
    start_idx = 0
    for i, row_idx in enumerate(content_rows[:50]):  # 最初の50行のみチェック
        row = gray[row_idx, :]
        non_white = row < white_threshold
        non_white_indices = np.where(non_white)[0]

        if len(non_white_indices) > 0:
            content_width = non_white_indices[-1] - non_white_indices[0]
            content_center = (non_white_indices[0] + non_white_indices[-1]) / 2

            # 単独ラベル（幅が狭く中央）をスキップ
            if content_width < w * 0.08 and w * 0.40 < content_center < w * 0.60:
                continue
            else:
                # 写真本体に到達
                start_idx = i
                break

    valid_rows = content_rows[start_idx:]
    if len(valid_rows) == 0:
        valid_rows = content_rows

    margin = 5
    y1 = max(0, valid_rows[0] - margin)
    y2 = min(h, valid_rows[-1] + margin)
    x1 = max(0, content_cols[0] - margin)
    x2 = min(w, content_cols[-1] + margin)

    return img.crop((x1, y1, x2, y2))


def extract_images_for_kai(kai, dry_run=False):
    """指定回次の画像を抽出"""
    print(f"\n{'='*50}")
    print(f"第{kai}回 画像抽出 (v4)")
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

    # 出力先を国家試験過去問/{回次}回/切り抜き/ に変更
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
                    print(f"  [{code}] 別冊{page_num:02d} なし")
                    skipped += len(labels)
                    continue

                img = Image.open(bessatsu_file)
                img_array = np.array(img)

                if is_blank_page(img_array):
                    print(f"  [{code}] 白紙スキップ")
                    skipped += len(labels)
                    continue

                num_images = len(labels)

                # A/Bラベル間で分割
                regions = split_by_ab_labels(img_array, num_images)

                if len(regions) == 0:
                    print(f"  [{code}] コンテンツなし")
                    skipped += num_images
                    continue

                while len(regions) < num_images:
                    regions.append(regions[-1])

                for i, (label, region) in enumerate(zip(labels, regions)):
                    x1, y1, x2, y2 = region
                    cropped_img = img.crop((x1, y1, x2, y2))
                    cropped_img = trim_header_footer_only(cropped_img)

                    if cropped_img.width < 100 or cropped_img.height < 100:
                        print(f"  [{code}] サイズ不足: {cropped_img.size}")
                        skipped += 1
                        continue

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

    parser = argparse.ArgumentParser(description='高解像度別冊画像抽出 v4')
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
        print("  python extract_hires_images_v4.py 118")
        print("  python extract_hires_images_v4.py --all")


if __name__ == "__main__":
    main()
