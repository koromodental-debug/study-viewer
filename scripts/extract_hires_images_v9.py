#!/usr/bin/env python3
"""
高解像度別冊画像から個別写真を切り抜くスクリプト v9

アプローチ:
- 「A」「B」ラベル行を検出
- ラベルから次のラベル（または末尾）までを1セクションとして切り出す
- ラベルがない場合はコンテンツ全体を1セクションとして
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


def find_label_positions(gray, white_threshold=240):
    """「A」「B」などの単独ラベル行を検出

    ラベルの特徴:
    - 中央に位置する狭い幅のコンテンツ
    - その上下は白い行
    """
    h, w = gray.shape
    header_end = int(h * 0.06)
    footer_start = int(h * 0.96)

    label_positions = []  # (label_top, label_bottom)

    y = header_end
    while y < footer_start:
        row = gray[y, :]
        non_white = np.where(row < white_threshold)[0]

        if len(non_white) > 0:
            content_width = non_white[-1] - non_white[0]
            content_center = (non_white[0] + non_white[-1]) / 2

            # ラベル候補: 幅が非常に狭く（5%以下）中央にある（A, B, C等の1文字）
            if content_width < w * 0.05 and w * 0.40 < content_center < w * 0.60:
                # 上下が白い行かチェック
                above_white = y > 0 and np.mean(gray[y-1, :] > white_threshold) > 0.95

                # ラベルブロックの範囲を確定
                label_top = y
                label_bottom = y

                # 下方向に探索
                for check_y in range(y + 1, min(footer_start, y + 60)):
                    check_row = gray[check_y, :]
                    check_non_white = np.where(check_row < white_threshold)[0]

                    if len(check_non_white) > 0:
                        cw = check_non_white[-1] - check_non_white[0]
                        cc = (check_non_white[0] + check_non_white[-1]) / 2
                        if cw < w * 0.12 and w * 0.35 < cc < w * 0.65:
                            label_bottom = check_y
                        else:
                            break
                    else:
                        break

                # ラベルの高さが合理的（20-70px）なら採用
                if 15 < label_bottom - label_top < 80:
                    # 既存のラベルと重複しないか
                    is_new = True
                    for lt, lb in label_positions:
                        if not (label_bottom < lt - 20 or label_top > lb + 20):
                            is_new = False
                            break

                    if is_new:
                        label_positions.append((label_top, label_bottom))
                        y = label_bottom + 1
                        continue

        y += 1

    label_positions.sort()
    return label_positions


def get_content_bounds(gray, y1, y2, white_threshold=240):
    """指定範囲内のコンテンツ境界を取得（フッター除外）"""
    h, w = gray.shape

    # フッター領域を除外（元画像の下部5%）
    # 元画像の高さから計算
    footer_y = int(h * 0.95)
    actual_y2 = min(y2, footer_y)

    region = gray[y1:actual_y2, :]

    row_has_content = np.mean(region < white_threshold, axis=1) > 0.005
    col_has_content = np.mean(region < white_threshold, axis=0) > 0.005

    rows = np.where(row_has_content)[0]
    cols = np.where(col_has_content)[0]

    if len(rows) == 0 or len(cols) == 0:
        return None

    return (
        max(0, cols[0] - 5),
        y1 + rows[0],
        min(w, cols[-1] + 5),
        y1 + rows[-1] + 20  # キャプション用余白
    )


def trim_bottom_whitespace(img_pil, white_threshold=240):
    """画像下部の余白とフッターを除去

    - ページ番号「— XX —」
    - 文書コード「DKIX-XX」
    - 白い余白
    - 薄いグレーの余白
    """
    img_array = np.array(img_pil.convert('L'))
    h, w = img_array.shape

    # 下から上に向かって、実際のコンテンツを探す
    last_content_row = h - 1

    for y in range(h - 1, max(0, h - 2000), -1):
        row = img_array[y, :]

        # 行の明るさの統計
        mean_brightness = np.mean(row)
        white_ratio = np.mean(row > white_threshold)

        # 非白ピクセルの位置
        non_white = np.where(row < white_threshold)[0]

        # 1. ほぼ白い行（90%以上白）→ 余白としてスキップ
        if white_ratio > 0.90:
            continue

        # 2. 明るいグレー背景（平均輝度230以上）→ 余白としてスキップ
        if mean_brightness > 230 and white_ratio > 0.80:
            continue

        # 3. 非白ピクセルがある場合、フッターかどうか判定
        if len(non_white) > 0:
            content_width = non_white[-1] - non_white[0]
            content_left = non_white[0]
            content_right = non_white[-1]

            # 中央部分の白さ
            mid_start = int(w * 0.30)
            mid_end = int(w * 0.70)
            mid_section = row[mid_start:mid_end]
            mid_white_ratio = np.mean(mid_section > white_threshold)

            # フッター判定
            is_footer = False

            # ページ番号: 幅が狭い（40%以下）
            if content_width < w * 0.40:
                is_footer = True

            # ページ番号 + 文書コード: 中央が白い（80%以上）
            if mid_white_ratio > 0.80:
                is_footer = True

            # 非白ピクセルの密度が低い（テキスト行）
            pixel_density = len(non_white) / max(1, content_width)
            if pixel_density < 0.20:
                is_footer = True

            if is_footer:
                continue

        # 実際のコンテンツ行を発見
        last_content_row = y
        break

    # 少し余白を追加
    new_bottom = min(h, last_content_row + 15)

    if new_bottom < h - 10:
        return img_pil.crop((0, 0, w, new_bottom))
    return img_pil


def split_page(img_array, num_expected):
    """ページをラベル基準で分割"""
    h, w = img_array.shape[:2]

    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array

    if is_blank_page(gray):
        return []

    header_end = int(h * 0.06)
    footer_start = int(h * 0.91)  # フッター（ページ番号、文書コード）を除外

    # ラベル位置を検出
    labels = find_label_positions(gray)

    regions = []

    if len(labels) == 0:
        # ラベルなし: コンテンツ全体を1つとして
        bounds = get_content_bounds(gray, header_end, footer_start)
        if bounds:
            regions.append(bounds)

    elif len(labels) == 1:
        # ラベル1つ: ラベルから末尾まで
        label_top, label_bottom = labels[0]
        bounds = get_content_bounds(gray, label_top - 10, footer_start)
        if bounds:
            # ラベルの上端を確実に含める
            x1, y1, x2, y2 = bounds
            y1 = min(y1, label_top - 5)
            regions.append((x1, y1, x2, y2))

    else:
        # 複数ラベル: 各ラベルから次のラベルまで
        for i, (label_top, label_bottom) in enumerate(labels):
            # 終了位置
            if i + 1 < len(labels):
                end_y = labels[i + 1][0] - 10
            else:
                end_y = footer_start

            bounds = get_content_bounds(gray, label_top - 10, end_y)
            if bounds:
                x1, y1, x2, y2 = bounds
                # ラベルを確実に含める
                y1 = min(y1, label_top - 5)
                # 末尾が次のラベルにかからないように
                y2 = min(y2, end_y)
                regions.append((x1, y1, x2, y2))

    # 期待数より少ない場合、ラベルなしでコンテンツ分割を試みる
    if len(regions) < num_expected and len(regions) > 0:
        # 既存の領域をそのまま返す（不足は警告）
        pass
    elif len(regions) > num_expected:
        regions = regions[:num_expected]

    return regions


def extract_images_for_kai(kai, dry_run=False):
    print(f"\n{'='*50}")
    print(f"第{kai}回 画像抽出 (v9 - ラベル検出改良)")
    print(f"{'='*50}")

    mapping = get_bessatsu_mapping(kai)
    print(f"別冊参照: {len(mapping)}問")

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
                    cropped = trim_bottom_whitespace(cropped)

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
        print("python extract_hires_images_v9.py 118")


if __name__ == "__main__":
    main()
