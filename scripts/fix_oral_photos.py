#!/usr/bin/env python3
"""
口腔内写真5枚セットの切り抜き修正スクリプト

問題: extract_hires_images_v10.pyで切り抜いた画像のうち、
口腔内写真5枚セット（十字型配置）で左端の写真が切れているものを修正

使用方法:
  python3 fix_oral_photos.py --kai 104 --dry-run  # 確認のみ
  python3 fix_oral_photos.py --kai 104            # 実際に修正
  python3 fix_oral_photos.py --all                # 全回次を修正
"""

import re
from pathlib import Path
from PIL import Image
import numpy as np
import cv2

# macOS Vision API
try:
    import Quartz
    from Foundation import NSURL
    import Vision
    HAS_VISION = True
except ImportError:
    HAS_VISION = False

BASE_DIR = Path("/Users/saitouryuuichi/Desktop/国試データベース")
KAKOMON_DIR = BASE_DIR / "国家試験過去問"


def extract_question_number_vision(img_path, section):
    """macOS Vision APIで画像から問題番号を抽出"""
    if not HAS_VISION:
        return None

    try:
        image_url = NSURL.fileURLWithPath_(str(img_path))
        source = Quartz.CGImageSourceCreateWithURL(image_url, None)
        cg_image = Quartz.CGImageSourceCreateImageAtIndex(source, 0, None)

        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg_image, None)
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        request.setRecognitionLanguages_(["ja-JP", "en-US"])

        success, error = handler.performRequests_error_([request], None)

        if success:
            results = request.results()
            all_texts = [obs.topCandidates_(1)[0].string() for obs in results]
            combined_text = ' '.join(all_texts)

            patterns = [
                rf'[（(]\s*{section}\s*問題\s*(\d+)\s*[）)]',
                rf'{section}\s*問題\s*(\d+)',
                rf'問題\s*(\d+)',
            ]

            for pattern in patterns:
                match = re.search(pattern, combined_text)
                if match:
                    return int(match.group(1))
    except:
        pass

    return None


def is_oral_photo_set(gray):
    """口腔内写真5枚セット（十字型配置）かどうかを判定

    特徴:
    - 5枚の写真が十字型に配置
    - 中段に3枚横並び
    - 上下に各1枚
    """
    h, w = gray.shape

    # 中央付近の水平方向のコンテンツ分布を確認
    mid_y = h // 2
    mid_region = gray[mid_y-50:mid_y+50, :]

    # 列ごとの暗いピクセル数
    col_dark = np.sum(mid_region < 240, axis=0)

    # 3つの山（3枚の写真）があるか確認
    threshold = np.max(col_dark) * 0.3
    peaks = []
    in_peak = False
    peak_start = 0

    for i, val in enumerate(col_dark):
        if val > threshold and not in_peak:
            in_peak = True
            peak_start = i
        elif val <= threshold and in_peak:
            in_peak = False
            peaks.append((peak_start, i))

    if in_peak:
        peaks.append((peak_start, len(col_dark)))

    # 3つのピークがあれば口腔内写真5枚セットの可能性が高い
    return len(peaks) >= 3


def get_full_content_bounds(gray, white_threshold=240):
    """画像全体からコンテンツ領域を取得（マージン大きめ）"""
    h, w = gray.shape

    # ヘッダーとフッターを除外
    header_end = int(h * 0.04)
    footer_start = int(h * 0.94)

    region = gray[header_end:footer_start, :]

    row_has_content = np.mean(region < white_threshold, axis=1) > 0.003
    col_has_content = np.mean(region < white_threshold, axis=0) > 0.003

    rows = np.where(row_has_content)[0]
    cols = np.where(col_has_content)[0]

    if len(rows) == 0 or len(cols) == 0:
        return None

    # マージンを大きめに取る（左端の写真が切れないように）
    margin = 15
    return (
        max(0, cols[0] - margin),
        header_end + rows[0] - 5,
        min(w, cols[-1] + margin),
        header_end + rows[-1] + 15
    )


def trim_bottom_whitespace(img_pil, white_threshold=240):
    """画像下部の余白を除去"""
    img_array = np.array(img_pil.convert('L'))
    h, w = img_array.shape

    for y in range(h - 1, max(0, h - 500), -1):
        row = img_array[y, :]
        white_ratio = np.mean(row > white_threshold)

        if white_ratio < 0.95:
            return img_pil.crop((0, 0, w, min(h, y + 15)))

    return img_pil


def check_and_fix_image(bessatsu_path, kirinuki_path, dry_run=True):
    """画像をチェックして必要なら修正"""
    # 別冊画像を読み込み
    img_pil = Image.open(bessatsu_path)

    # 横向き画像の場合は回転（幅 > 高さの場合）
    needs_rotation = img_pil.width > img_pil.height
    if needs_rotation:
        img_pil = img_pil.rotate(90, expand=True)

    img_cv = cv2.cvtColor(np.array(img_pil), cv2.COLOR_RGB2BGR)
    if img_cv is None:
        return None, "読み込み失敗"

    img_cv = cv2.cvtColor(img_cv, cv2.COLOR_BGR2RGB)
    gray = cv2.cvtColor(img_cv, cv2.COLOR_RGB2GRAY)

    # 口腔内写真5枚セットかチェック
    if not is_oral_photo_set(gray):
        return None, "5枚セットではない"

    # 現在の切り抜きと比較
    if kirinuki_path.exists():
        current = Image.open(kirinuki_path)
        current_w, current_h = current.size
    else:
        current_w, current_h = 0, 0

    # 新しい切り抜き範囲を計算
    bounds = get_full_content_bounds(gray)
    if not bounds:
        return None, "境界検出失敗"

    x1, y1, x2, y2 = bounds
    new_w = x2 - x1

    # 幅が現在より10%以上大きければ修正が必要
    if current_w > 0 and new_w <= current_w * 1.05:
        return None, "修正不要"

    # 修正実行（回転済みのimg_pilを使用）
    cropped = img_pil.crop((x1, y1, x2, y2))
    cropped = trim_bottom_whitespace(cropped)

    if not dry_run:
        # バックアップ
        if kirinuki_path.exists():
            backup_path = kirinuki_path.with_suffix('.png.bak')
            if not backup_path.exists():
                kirinuki_path.rename(backup_path)

        cropped.save(kirinuki_path)

    return cropped.size, f"修正{'予定' if dry_run else '完了'}: {current_w}→{cropped.width}px"


def fix_kai(kai, dry_run=True):
    """指定回次の口腔内写真を修正"""
    print(f"\n{'='*50}")
    print(f"第{kai}回 口腔内写真修正 {'(dry-run)' if dry_run else ''}")
    print(f"{'='*50}")

    bessatsu_dir = KAKOMON_DIR / f"{kai}回" / "別冊"
    kirinuki_dir = KAKOMON_DIR / f"{kai}回" / "切り抜き"

    if not bessatsu_dir.exists():
        print(f"別冊ディレクトリなし: {bessatsu_dir}")
        return 0

    fixed_count = 0

    for section in ['A', 'B', 'C', 'D']:
        section_files = sorted(bessatsu_dir.glob(f"{kai}{section}_別冊*.png"))

        for bessatsu_file in section_files:
            # 問題番号を取得
            q_num = extract_question_number_vision(bessatsu_file, section)
            if q_num is None:
                continue

            code = f"{kai}{section}{q_num}"
            kirinuki_path = kirinuki_dir / f"{code}.png"

            result, msg = check_and_fix_image(bessatsu_file, kirinuki_path, dry_run)

            if result:
                print(f"  [{code}] {msg} → {result}")
                fixed_count += 1

    print(f"\n修正{'予定' if dry_run else '完了'}: {fixed_count}件")
    return fixed_count


def main():
    import argparse
    parser = argparse.ArgumentParser(description='口腔内写真5枚セットの切り抜き修正')
    parser.add_argument('--kai', type=int, help='対象回次')
    parser.add_argument('--all', action='store_true', help='全回次を処理')
    parser.add_argument('--dry-run', action='store_true', help='確認のみ（実際には修正しない）')
    args = parser.parse_args()

    if not HAS_VISION:
        print("エラー: macOS Vision APIが必要です")
        return

    if args.all:
        total = 0
        for kai in range(102, 118):
            total += fix_kai(kai, args.dry_run)
        print(f"\n総計: {total}件")
    elif args.kai:
        fix_kai(args.kai, args.dry_run)
    else:
        print("使用方法:")
        print("  python3 fix_oral_photos.py --kai 104 --dry-run  # 確認のみ")
        print("  python3 fix_oral_photos.py --kai 104            # 実際に修正")
        print("  python3 fix_oral_photos.py --all --dry-run      # 全回次を確認")


if __name__ == "__main__":
    main()
