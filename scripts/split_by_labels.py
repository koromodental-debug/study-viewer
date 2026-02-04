#!/usr/bin/env python3
"""
別冊画像のA/B/Cラベル検出・分割スクリプト

1ページに複数のセクション（A, B, C等）がある別冊画像を
ラベルで分割して個別ファイルとして保存する

使用方法:
  python3 split_by_labels.py --kai 104 --dry-run  # 確認のみ
  python3 split_by_labels.py --kai 104            # 実際に分割
"""

import re
from pathlib import Path
from PIL import Image
import numpy as np

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


def detect_labels_vision(img_path):
    """macOS Vision APIで画像からA/B/Cラベルを検出

    Returns:
        list of (label, y_position, bbox): ラベルとその位置情報
    """
    if not HAS_VISION:
        return []

    try:
        image_url = NSURL.fileURLWithPath_(str(img_path))
        source = Quartz.CGImageSourceCreateWithURL(image_url, None)
        cg_image = Quartz.CGImageSourceCreateImageAtIndex(source, 0, None)

        # 画像サイズを取得
        img_width = Quartz.CGImageGetWidth(cg_image)
        img_height = Quartz.CGImageGetHeight(cg_image)

        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg_image, None)
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        request.setRecognitionLanguages_(["ja-JP", "en-US"])

        success, error = handler.performRequests_error_([request], None)

        labels = []
        all_detected = []  # デバッグ用

        if success:
            results = request.results()
            for obs in results:
                text = obs.topCandidates_(1)[0].string()
                bbox = obs.boundingBox()

                # bboxはnormalized座標（0-1、左下原点）
                x_center = bbox.origin.x + bbox.size.width / 2
                y_top = 1.0 - (bbox.origin.y + bbox.size.height)
                y_pixel = int(y_top * img_height)

                all_detected.append(f"{text}@({x_center:.2f},{y_top:.2f})")

                # 単独のA, B, C, Dラベルを検出
                # 条件: 1文字のA-D、水平方向で中央付近（0.2-0.8に拡大）
                if text.strip() in ['A', 'B', 'C', 'D']:
                    if 0.2 <= x_center <= 0.8:
                        labels.append({
                            'label': text.strip(),
                            'y': y_pixel,
                            'bbox': bbox,
                            'height': int(bbox.size.height * img_height)
                        })

        # Y座標でソート（上から順）
        labels.sort(key=lambda x: x['y'])

        # 重複ラベルを除去（同じ文字が複数検出された場合は最初のものを使用）
        seen = set()
        unique_labels = []
        for label in labels:
            if label['label'] not in seen:
                seen.add(label['label'])
                unique_labels.append(label)

        return unique_labels

    except Exception as e:
        print(f"  エラー: {e}")
        return []


def split_image_by_labels(img_path, labels, output_dir, dry_run=True):
    """ラベル位置で画像を分割

    Args:
        img_path: 入力画像パス
        labels: detect_labels_visionの戻り値
        output_dir: 出力ディレクトリ
        dry_run: Trueなら実際には保存しない

    Returns:
        list of output paths
    """
    if len(labels) < 1:
        return []

    img = Image.open(img_path)
    width, height = img.size

    # ファイル名のベースを取得
    base_name = img_path.stem  # e.g., "104A_問題01"

    outputs = []

    # 最初のラベルの前に「A」セクションがあるか確認
    # 「No. X A」形式でAがページ番号と一緒に記載されている場合
    first_label = labels[0]['label']
    first_label_y = labels[0]['y']

    if first_label != 'A' and first_label_y > 200:
        # 最初のラベルがB以降で、上に200px以上のスペースがある場合
        # → その上に「A」セクションがある可能性が高い

        # ヘッダー部分（ページ番号等）をスキップして80pxから開始
        header_skip = 80
        y_end = first_label_y - 5

        if y_end > header_skip + 100:  # 最低100px以上のコンテンツ
            cropped = img.crop((0, header_skip, width, y_end))
            cropped = trim_whitespace(cropped)

            if cropped.size[1] > 50:  # トリム後も50px以上あれば
                output_name = f"{base_name}_A.png"
                output_path = output_dir / output_name

                if not dry_run:
                    cropped.save(output_path)

                outputs.append({
                    'path': output_path,
                    'label': 'A',
                    'size': cropped.size
                })

    for i, label_info in enumerate(labels):
        label = label_info['label']
        y_start = label_info['y'] + label_info['height'] + 5  # ラベルの下から

        # 次のラベルまたは画像の終わりまで
        if i + 1 < len(labels):
            y_end = labels[i + 1]['y'] - 5  # 次のラベルの上まで
        else:
            y_end = height

        # 切り抜き
        if y_end > y_start + 50:  # 最低50px以上
            cropped = img.crop((0, y_start, width, y_end))

            # 余白をトリム
            cropped = trim_whitespace(cropped)

            output_name = f"{base_name}_{label}.png"
            output_path = output_dir / output_name

            if not dry_run:
                cropped.save(output_path)

            outputs.append({
                'path': output_path,
                'label': label,
                'size': cropped.size
            })

    return outputs


def trim_whitespace(img, threshold=245):
    """画像の余白をトリム"""
    gray = np.array(img.convert('L'))

    # 非白ピクセルを検出
    non_white = gray < threshold

    rows = np.any(non_white, axis=1)
    cols = np.any(non_white, axis=0)

    if not np.any(rows) or not np.any(cols):
        return img

    row_indices = np.where(rows)[0]
    col_indices = np.where(cols)[0]

    y1, y2 = row_indices[0], row_indices[-1]
    x1, x2 = col_indices[0], col_indices[-1]

    # マージンを追加
    margin = 10
    y1 = max(0, y1 - margin)
    y2 = min(img.height, y2 + margin)
    x1 = max(0, x1 - margin)
    x2 = min(img.width, x2 + margin)

    return img.crop((x1, y1, x2, y2))


def process_kai(kai, dry_run=True):
    """指定回次の別冊画像を処理"""
    print(f"\n{'='*50}")
    print(f"第{kai}回 別冊画像分割 {'(dry-run)' if dry_run else ''}")
    print(f"{'='*50}")

    bessatsu_dir = KAKOMON_DIR / f"{kai}回" / "別冊_renamed"
    if not bessatsu_dir.exists():
        bessatsu_dir = KAKOMON_DIR / f"{kai}回" / "別冊"

    if not bessatsu_dir.exists():
        print(f"ディレクトリなし: {bessatsu_dir}")
        return 0

    # 出力ディレクトリ
    output_dir = KAKOMON_DIR / f"{kai}回" / "別冊_split"
    if not dry_run:
        output_dir.mkdir(exist_ok=True)

    split_count = 0
    skip_count = 0

    # PNG画像を処理
    for img_path in sorted(bessatsu_dir.glob("*.png")):
        print(f"\n処理中: {img_path.name}")

        # ラベルを検出
        labels = detect_labels_vision(img_path)

        if len(labels) == 0:
            print(f"  ラベルなし（スキップ）")
            skip_count += 1
            continue

        if len(labels) == 1:
            print(f"  ラベル1つのみ: {labels[0]['label']}")
            # 1つだけの場合はトリムのみ
            img = Image.open(img_path)
            y_start = labels[0]['y'] + labels[0]['height'] + 5
            cropped = img.crop((0, y_start, img.width, img.height))
            cropped = trim_whitespace(cropped)

            output_name = f"{img_path.stem}_{labels[0]['label']}.png"
            output_path = output_dir / output_name

            if not dry_run:
                cropped.save(output_path)

            print(f"  → {output_name} ({cropped.size[0]}x{cropped.size[1]})")
            split_count += 1
        else:
            # 複数ラベル
            label_names = [l['label'] for l in labels]
            print(f"  ラベル検出: {', '.join(label_names)}")

            outputs = split_image_by_labels(img_path, labels, output_dir, dry_run)

            for out in outputs:
                print(f"  → {out['path'].name} ({out['size'][0]}x{out['size'][1]})")
                split_count += 1

    print(f"\n処理完了: {split_count}件分割, {skip_count}件スキップ")
    return split_count


def main():
    import argparse
    parser = argparse.ArgumentParser(description='別冊画像のA/B/Cラベル分割')
    parser.add_argument('--kai', type=int, help='対象回次')
    parser.add_argument('--all', action='store_true', help='全回次を処理')
    parser.add_argument('--dry-run', action='store_true', help='確認のみ')
    args = parser.parse_args()

    if not HAS_VISION:
        print("エラー: macOS Vision APIが必要です")
        print("pyobjcをインストールしてください: pip install pyobjc")
        return

    if args.all:
        total = 0
        for kai in range(102, 118):
            total += process_kai(kai, args.dry_run)
        print(f"\n総計: {total}件")
    elif args.kai:
        process_kai(args.kai, args.dry_run)
    else:
        print("使用方法:")
        print("  python3 split_by_labels.py --kai 104 --dry-run  # 確認のみ")
        print("  python3 split_by_labels.py --kai 104            # 実際に分割")
        print("  python3 split_by_labels.py --all --dry-run      # 全回次を確認")


if __name__ == "__main__":
    main()
