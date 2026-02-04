#!/usr/bin/env python3
"""
別冊画像抽出スクリプト（シンプル版）

1. pdftoppm でPDFをページ画像に変換
2. macOS Vision APIでヘッダーを読み取り
3. ファイルをリネーム

使用方法:
  python3 extract_bessatsu_simple.py --kai 107 --dry-run
  python3 extract_bessatsu_simple.py --kai 107
"""

import subprocess
import re
from pathlib import Path
import shutil

# macOS Vision API
try:
    import Quartz
    from Foundation import NSURL
    import Vision
    HAS_VISION = True
except ImportError:
    HAS_VISION = False

BASE_DIR = Path("/Users/saitouryuuichi/Desktop/国試データベース")
PDF_DIR = BASE_DIR / "PDF原本"
KAKOMON_DIR = BASE_DIR / "国家試験過去問"


def extract_header_info(img_path):
    """画像のヘッダーからNo.とセクション情報を読み取る

    例: "No. 11 B (A 問題92)" → {'no': 11, 'sub': 'B', 'section': 'A', 'mondai': 92}
    例: "No. 2 (A 問題38)" → {'no': 2, 'sub': None, 'section': 'A', 'mondai': 38}
    """
    if not HAS_VISION:
        return None

    try:
        image_url = NSURL.fileURLWithPath_(str(img_path))
        source = Quartz.CGImageSourceCreateWithURL(image_url, None)
        cg_image = Quartz.CGImageSourceCreateImageAtIndex(source, 0, None)

        img_height = Quartz.CGImageGetHeight(cg_image)

        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg_image, None)
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        request.setRecognitionLanguages_(["ja-JP", "en-US"])

        success, error = handler.performRequests_error_([request], None)

        if success:
            results = request.results()

            # 上部20%のテキストのみを対象
            header_texts = []
            for obs in results:
                bbox = obs.boundingBox()
                y_top = 1.0 - (bbox.origin.y + bbox.size.height)

                if y_top < 0.15:  # 上部15%
                    text = obs.topCandidates_(1)[0].string()
                    header_texts.append(text)

            combined = ' '.join(header_texts)

            # パターン1: "No. X Y (セクション 問題Z)" - A/B/Cサブ画像あり
            # スペースありなし両対応: "No. 11 A" or "No. 11A"
            match = re.search(r'No\.?\s*(\d+)\s*([A-D])\s*[（(]\s*([A-D])\s*問題\s*(\d+)', combined)
            if match:
                return {
                    'no': int(match.group(1)),
                    'sub': match.group(2),
                    'section': match.group(3),
                    'mondai': int(match.group(4))
                }

            # パターン2: "No. X (セクション 問題Y)" - サブ画像なし
            match = re.search(r'No\.?\s*(\d+)\s*[（(]\s*([A-D])\s*問題\s*(\d+)', combined)
            if match:
                return {
                    'no': int(match.group(1)),
                    'sub': None,
                    'section': match.group(2),
                    'mondai': int(match.group(3))
                }

    except Exception as e:
        print(f"  OCRエラー: {e}")

    return None


def process_kai(kai, dry_run=True):
    """指定回次の別冊を処理"""
    print(f"\n{'='*50}")
    print(f"第{kai}回 別冊画像抽出 {'(dry-run)' if dry_run else ''}")
    print(f"{'='*50}")

    pdf_kai_dir = PDF_DIR / f"{kai}回"
    output_dir = KAKOMON_DIR / f"{kai}回" / "別冊_v2"
    temp_dir = KAKOMON_DIR / f"{kai}回" / "temp_pages"

    if not pdf_kai_dir.exists():
        print(f"PDFディレクトリなし: {pdf_kai_dir}")
        return 0

    if not dry_run:
        output_dir.mkdir(exist_ok=True)
        temp_dir.mkdir(exist_ok=True)

    total_count = 0

    for section in ['A', 'B', 'C', 'D']:
        # PDFファイルを探す（命名パターンが複数ある）
        pdf_patterns = [
            f"{kai}回_{section}_別冊.pdf",
            f"{kai}回_{section}別冊.pdf",
        ]

        pdf_path = None
        for pattern in pdf_patterns:
            candidate = pdf_kai_dir / pattern
            if candidate.exists():
                pdf_path = candidate
                break

        if not pdf_path:
            continue

        print(f"\n[{section}] {pdf_path.name}")

        # pdftoppmでページ画像を作成
        temp_prefix = temp_dir / f"{kai}{section}_page"

        if not dry_run:
            cmd = [
                "pdftoppm", "-png", "-r", "300",
                str(pdf_path), str(temp_prefix)
            ]
            subprocess.run(cmd, capture_output=True)

        # 生成されたページ画像を処理
        if dry_run:
            # dry-runの場合は既存のtemp_pagesを使うか、スキップ
            page_files = sorted(temp_dir.glob(f"{kai}{section}_page-*.png")) if temp_dir.exists() else []
        else:
            page_files = sorted(temp_dir.glob(f"{kai}{section}_page-*.png"))

        for page_file in page_files:
            # ヘッダーからNo.と問題番号を読み取り
            info = extract_header_info(page_file)

            if info:
                # ファイル名を決定
                if info['sub']:
                    new_name = f"{kai}{info['section']}{info['mondai']}_{info['sub']}.png"
                else:
                    new_name = f"{kai}{info['section']}{info['mondai']}.png"

                new_path = output_dir / new_name

                print(f"  {page_file.name} → {new_name}")

                if not dry_run:
                    shutil.copy(page_file, new_path)

                total_count += 1
            else:
                # ヘッダーが読めない場合（目次ページなど）
                print(f"  {page_file.name} → スキップ（ヘッダー読み取り失敗）")

    # 一時ファイルを削除
    if not dry_run and temp_dir.exists():
        shutil.rmtree(temp_dir)

    print(f"\n完了: {total_count}件")
    return total_count


def main():
    import argparse
    parser = argparse.ArgumentParser(description='別冊画像抽出（シンプル版）')
    parser.add_argument('--kai', type=int, help='対象回次')
    parser.add_argument('--dry-run', action='store_true', help='確認のみ')
    args = parser.parse_args()

    if not HAS_VISION:
        print("エラー: macOS Vision APIが必要です")
        return

    if args.kai:
        process_kai(args.kai, args.dry_run)
    else:
        print("使用方法:")
        print("  python3 extract_bessatsu_simple.py --kai 107 --dry-run")
        print("  python3 extract_bessatsu_simple.py --kai 107")


if __name__ == "__main__":
    main()
