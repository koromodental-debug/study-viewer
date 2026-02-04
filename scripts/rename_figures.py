#!/usr/bin/env python3
"""
問題_図のファイルを問題番号でリネームするスクリプト

1. CSVからページ→問題コードのマッピングを取得
2. マッピングがない場合はVision OCRで問題番号を検出
"""

import csv
import re
import shutil
from pathlib import Path

# macOS Vision API
try:
    import Quartz
    from Foundation import NSURL
    import Vision
    HAS_VISION = True
except ImportError:
    HAS_VISION = False

BASE_DIR = Path("/Users/saitouryuuichi/Desktop/国試データベース/国家試験過去問")


def extract_question_from_vision(img_path, section):
    """Vision APIで問題番号を検出"""
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

            # 最初のテキスト（問題番号が左上にある）をチェック
            for text in all_texts[:5]:
                # 単独の数字（問題番号）
                match = re.match(r'^(\d{1,3})\s', text)
                if match:
                    return int(match.group(1))

            combined_text = ' '.join(all_texts)

            # "問題 XX" パターンを検索
            patterns = [
                rf'問題\s*(\d+)',
                rf'^(\d+)\s+\D',  # 行頭の数字
            ]

            for pattern in patterns:
                match = re.search(pattern, combined_text)
                if match:
                    return int(match.group(1))

    except Exception as e:
        pass

    return None


def get_page_mapping_from_csv(kai):
    """CSVからページ→問題コードのマッピングを取得"""
    csv_path = BASE_DIR / f"{kai}回" / f"{kai}回_問題一覧.csv"

    if not csv_path.exists():
        return {}

    mapping = {}

    with open(csv_path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            filename = row.get('ファイル名', '')
            code = row.get('問題コード', '')

            if not code:
                continue

            match = re.match(rf'({kai}[A-D])_page(\d+)', filename)
            if match:
                section = match.group(1)
                page = int(match.group(2))
                key = f"{section}_page{page:03d}"
                mapping[key] = code

    return mapping


def get_question_from_page_filename(page_file, kai, section):
    """問題_ページのファイル名からQ番号を取得（Q16-17なら最後の17を返す）"""
    filename = page_file.name
    # パターン: _Q数字-数字_ または _Q数字_
    match = re.search(r'_Q(\d+)(?:-(\d+))?[_.]', filename)
    if match:
        # 範囲がある場合は最後の番号を返す（図はページ下部にあるので最後の問題）
        if match.group(2):
            return f"{kai}{section}{match.group(2)}"
        return f"{kai}{section}{match.group(1)}"
    return None


def rename_figures_for_kai(kai, dry_run=True):
    """指定回次の問題_図をリネーム"""
    print(f"\n{'='*50}")
    print(f"第{kai}回 問題_図リネーム")
    print(f"{'='*50}")

    fig_dir = BASE_DIR / f"{kai}回" / "問題_図"
    page_dir = BASE_DIR / f"{kai}回" / "問題_ページ"

    if not fig_dir.exists():
        print("問題_図フォルダなし")
        return 0, 0

    # CSVからマッピング取得
    mapping = get_page_mapping_from_csv(kai)
    print(f"CSVマッピング: {len(mapping)}件")

    renamed = 0
    failed = 0

    for f in sorted(fig_dir.glob(f"{kai}*_page*.png")):
        match = re.match(rf'({kai}[A-D])_page(\d+)_fig(\d+)\.png', f.name)
        if not match:
            continue

        section_full = match.group(1)
        section = section_full[-1]  # A, B, C, D
        page = int(match.group(2))
        fig_num = match.group(3)
        key = f"{section_full}_page{page:03d}"

        code = None

        # 問題_ページファイルを探す
        page_patterns = [
            f"{section_full}_page{page:03d}*.png",
            f"{section_full}_page{page}*.png",
        ]
        page_file = None
        for pattern in page_patterns:
            candidates = list(page_dir.glob(pattern))
            if candidates:
                page_file = candidates[0]
                break

        # 1. 問題_ページのファイル名からQ番号を取得（優先）
        if page_file:
            code = get_question_from_page_filename(page_file, kai, section)

        # 2. ファイル名から取れなければCSVマッピング
        if not code and key in mapping:
            code = mapping[key]

        # 3. それでもなければVision OCR
        if not code and page_file and page_file.exists():
            q_num = extract_question_from_vision(page_file, section)
            if q_num:
                code = f"{kai}{section}{q_num}"

        if code:
            new_name = f"{code}_図{fig_num}.png"
            new_path = fig_dir / new_name

            if dry_run:
                print(f"  {f.name} → {new_name}")
            else:
                if new_path.exists() and new_path != f:
                    # 既存ファイルがある場合は連番追加
                    i = 2
                    while new_path.exists():
                        new_name = f"{code}_図{fig_num}_{i}.png"
                        new_path = fig_dir / new_name
                        i += 1

                f.rename(new_path)
                print(f"  {f.name} → {new_name}")
            renamed += 1
        else:
            print(f"  {f.name} → 検出失敗")
            failed += 1

    print(f"\n完了: {renamed}件リネーム, {failed}件失敗")
    return renamed, failed


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('kai', type=int, nargs='?')
    parser.add_argument('--execute', action='store_true', help='実際にリネーム')
    parser.add_argument('--all', action='store_true')
    args = parser.parse_args()

    dry_run = not args.execute

    if dry_run:
        print("[DRY RUN] --execute で実際にリネーム\n")

    if args.all:
        for kai in range(102, 119):
            rename_figures_for_kai(kai, dry_run)
    elif args.kai:
        rename_figures_for_kai(args.kai, dry_run)
    else:
        print("python rename_figures.py 118")
        print("python rename_figures.py 118 --execute")
        print("python rename_figures.py --all --execute")


if __name__ == "__main__":
    main()
