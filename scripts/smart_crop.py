#!/usr/bin/env python3
"""
スマートクロップスクリプト

別冊画像からヘッダー・ページ番号を除去し、画像とキャプションだけを残す。
- 画像領域を自動検出（小さいテキスト領域はスキップ）
- 下部にマージンを追加（キャプションを保持）

使用方法:
  python3 smart_crop.py --dir 別冊_v3 --dry-run    # 確認のみ
  python3 smart_crop.py --dir 別冊_v3              # 実行（上書き）
  python3 smart_crop.py --dir 別冊_v3 --backup     # バックアップ作成
"""

import argparse
from pathlib import Path
from PIL import Image
import numpy as np
import shutil


def smart_crop(img, threshold=245, min_content_size=100,
               margin_top=0, margin_bottom=80, margin_left=10, margin_right=10):
    """画像をスマートクロップする

    Args:
        img: PIL Image
        threshold: 白とみなす輝度閾値（0-255）
        min_content_size: 画像とみなす最小連続ピクセル数
        margin_*: 各方向のマージン

    Returns:
        cropped PIL Image
    """
    arr = np.array(img.convert("L"))
    height, width = arr.shape

    row_means = arr.mean(axis=1)
    col_means = arr.mean(axis=0)

    def find_content_bounds(means, length, min_size):
        """連続した非白領域を検出"""
        # 上/左から
        start = 0
        in_content = False
        content_start = 0

        for i in range(length):
            is_white = means[i] >= threshold
            if not is_white and not in_content:
                content_start = i
                in_content = True
            elif is_white and in_content:
                if i - content_start >= min_size:
                    start = content_start
                    break
                in_content = False
        if in_content:
            start = content_start

        # 下/右から
        end = length
        in_content = False
        content_end = length

        for i in range(length - 1, -1, -1):
            is_white = means[i] >= threshold
            if not is_white and not in_content:
                content_end = i + 1
                in_content = True
            elif is_white and in_content:
                if content_end - i - 1 >= min_size:
                    end = content_end
                    break
                in_content = False
        if in_content:
            end = content_end

        return start, end

    top, bottom = find_content_bounds(row_means, height, min_content_size)
    left, right = find_content_bounds(col_means, width, min_content_size)

    # マージン適用
    top = max(0, top - margin_top)
    bottom = min(height, bottom + margin_bottom)
    left = max(0, left - margin_left)
    right = min(width, right + margin_right)

    return img.crop((left, top, right, bottom))


def process_directory(dir_path, dry_run=False, backup=False):
    """ディレクトリ内の全PNG画像を処理"""
    dir_path = Path(dir_path)

    if not dir_path.exists():
        print(f"エラー: ディレクトリが存在しません: {dir_path}")
        return

    png_files = sorted(dir_path.glob("*.png"))

    # _auto, _trimmed などのテスト用ファイルを除外
    png_files = [f for f in png_files if not any(x in f.stem for x in ['_auto', '_trimmed', '_backup'])]

    print(f"対象ファイル: {len(png_files)}件")
    print(f"モード: {'dry-run（確認のみ）' if dry_run else '実行'}")
    if backup:
        print("バックアップ: 有効")
    print()

    processed = 0
    skipped = 0

    for png_file in png_files:
        try:
            img = Image.open(png_file)
            orig_size = img.size

            cropped = smart_crop(img)
            new_size = cropped.size

            # サイズ変化率
            reduction = 1 - (new_size[0] * new_size[1]) / (orig_size[0] * orig_size[1])

            if reduction < 0.01:
                # ほとんど変化なし
                print(f"  {png_file.name} → スキップ（変化なし）")
                skipped += 1
                continue

            print(f"  {png_file.name}: {orig_size[0]}x{orig_size[1]} → {new_size[0]}x{new_size[1]} ({reduction*100:.1f}%削減)")

            if not dry_run:
                if backup:
                    backup_path = png_file.with_suffix('.backup.png')
                    shutil.copy(png_file, backup_path)

                cropped.save(png_file)

            processed += 1

        except Exception as e:
            print(f"  {png_file.name} → エラー: {e}")

    print()
    print(f"完了: {processed}件処理, {skipped}件スキップ")


def main():
    parser = argparse.ArgumentParser(description='別冊画像のスマートクロップ')
    parser.add_argument('--dir', required=True, help='処理するディレクトリ')
    parser.add_argument('--dry-run', action='store_true', help='確認のみ（実際には処理しない）')
    parser.add_argument('--backup', action='store_true', help='処理前にバックアップを作成')
    args = parser.parse_args()

    process_directory(args.dir, dry_run=args.dry_run, backup=args.backup)


if __name__ == "__main__":
    main()
