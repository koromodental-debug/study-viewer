#!/usr/bin/env python3
"""
別冊画像抽出スクリプト v2

1. pdftoppm でPDFをページ画像に変換
2. OCRでヘッダーと、ページ内のB/Cラベルを検出
3. ラベルがあればImageMagickで分割
4. 横向きページは回転して処理（両方向を試行）
5. リネームして保存

使用方法:
  python3 extract_bessatsu_v2.py --kai 107 --dry-run
  python3 extract_bessatsu_v2.py --kai 107
"""

import subprocess
import re
from pathlib import Path
import shutil
import os

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


def ocr_image(img_path, rotated=False, angle=-90):
    """画像全体をOCRしてテキストと位置情報を返す

    angle: 回転角度（-90=反時計回り, 90=時計回り）
    """
    if not HAS_VISION:
        return [], False

    try:
        from PIL import Image as PILImage

        if rotated:
            pil_img = PILImage.open(img_path)
            pil_img = pil_img.rotate(angle, expand=True)
            temp_path = str(img_path) + ".rotated.png"
            pil_img.save(temp_path)
            image_url = NSURL.fileURLWithPath_(temp_path)
        else:
            image_url = NSURL.fileURLWithPath_(str(img_path))

        source = Quartz.CGImageSourceCreateWithURL(image_url, None)
        cg_image = Quartz.CGImageSourceCreateImageAtIndex(source, 0, None)

        img_height = Quartz.CGImageGetHeight(cg_image)
        img_width = Quartz.CGImageGetWidth(cg_image)

        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg_image, None)
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        request.setRecognitionLanguages_(["ja-JP", "en-US"])

        success, error = handler.performRequests_error_([request], None)

        results = []
        if success:
            for obs in request.results():
                text = obs.topCandidates_(1)[0].string()
                bbox = obs.boundingBox()
                y_top = 1.0 - (bbox.origin.y + bbox.size.height)
                x_center = bbox.origin.x + bbox.size.width / 2

                results.append({
                    'text': text,
                    'y_ratio': y_top,
                    'y_pixel': int(y_top * img_height),
                    'x_center': x_center,
                    'height': img_height,
                    'width': img_width
                })

        if rotated:
            os.remove(temp_path)

        return results, rotated

    except Exception as e:
        print(f"  OCRエラー: {e}")
        return [], False


def extract_header_info(ocr_results):
    """OCR結果からヘッダー情報を抽出"""
    # 上部15%のテキストをx座標でソートして結合（左から右の順序で）
    header_items = [(r['x_center'], r['text']) for r in ocr_results if r['y_ratio'] < 0.15]
    header_items.sort(key=lambda x: x[0])
    header_texts = [text for _, text in header_items]
    combined = ' '.join(header_texts)

    # OCR誤認識の補正
    # 1. 「（3 問題」→「（B 問題」（3がBと誤認識）
    # 2. 「（B 3 問題」→「（B 問題」（余計な数字が入る）
    # 3. 「（8 問題」→「（B 問題」（8がBと誤認識）
    combined_fixed = re.sub(r'[（(]\s*[38]\s*問題', '（B 問題', combined)
    combined_fixed = re.sub(r'[（(]\s*([A-D])\s+[0-9]+\s*問題', r'（\1 問題', combined_fixed)
    combined_fixed = re.sub(r'[（(]\s*[Aa]\s*問題', '（A 問題', combined_fixed)

    # パターン1: "No. X Y (セクション 問題Z)" - A/B/Cサブ画像あり
    # コロン「：」が入る場合もあるため許容
    match = re.search(r'No\.?\s*(\d+)\s*([A-D])\s*[（(]\s*([A-D])\s*[：:]?\s*問題\s*(\d+)', combined_fixed)
    if match:
        return {
            'no': int(match.group(1)),
            'sub': match.group(2),
            'section': match.group(3),
            'mondai': int(match.group(4))
        }

    # パターン2: "No. X (セクション 問題Y)" - サブ画像なし
    match = re.search(r'No\.?\s*(\d+)\s*[（(]\s*([A-D])\s*[：:]?\s*問題\s*(\d+)', combined_fixed)
    if match:
        return {
            'no': int(match.group(1)),
            'sub': None,
            'section': match.group(2),
            'mondai': int(match.group(3))
        }

    return None


def find_section_labels(ocr_results):
    """ページ内のB/C/Dラベル（分割位置）を検出

    横並び・縦並び両方に対応するため、x座標情報も保持
    """
    labels = []

    for r in ocr_results:
        text = r['text'].strip()
        # B/C/Dラベルを検出（x座標の制限を緩和）
        if text in ['B', 'C', 'D']:
            if r['y_ratio'] > 0.10:  # ヘッダーより下
                labels.append({
                    'label': text,
                    'y_pixel': r['y_pixel'],
                    'y_ratio': r['y_ratio'],
                    'x_center': r['x_center'],
                    'x_pixel': int(r['x_center'] * r['width'])
                })

    # ラベルの配置パターンを判定（横並びか縦並びか）
    if len(labels) >= 2:
        # y座標の差とx座標の差を比較
        y_range = max(l['y_ratio'] for l in labels) - min(l['y_ratio'] for l in labels)
        x_range = max(l['x_center'] for l in labels) - min(l['x_center'] for l in labels)

        if x_range > 0.3 and y_range < 0.15:
            # 横並び: x座標でソート
            labels.sort(key=lambda x: x['x_center'])
            for l in labels:
                l['layout'] = 'horizontal'
        else:
            # 縦並び: y座標でソート
            labels.sort(key=lambda x: x['y_pixel'])
            for l in labels:
                l['layout'] = 'vertical'
    elif labels:
        labels[0]['layout'] = 'single'

    return labels


def split_image_by_labels(img_path, labels, output_dir, base_name, header_sub, dry_run, rotation_angle=None):
    """ラベル位置で画像を分割（縦並び・横並び両対応）"""
    from PIL import Image
    img = Image.open(img_path)

    if rotation_angle:
        img = img.rotate(rotation_angle, expand=True)

    width, height = img.size
    outputs = []

    # レイアウトタイプを判定
    layout = labels[0].get('layout', 'vertical') if labels else 'vertical'

    if layout == 'horizontal':
        # 横並び: ラベル間の中間点で分割
        section_labels = [label['label'] for label in labels]

        # 分割ポイント: 連続するラベルの中間点
        split_points = [0]
        for i in range(len(labels) - 1):
            # i番目とi+1番目のラベルの中間点で分割
            mid_point = (labels[i]['x_pixel'] + labels[i + 1]['x_pixel']) // 2
            split_points.append(mid_point)
        split_points.append(width)

        for i in range(len(split_points) - 1):
            x_start = max(0, split_points[i])
            x_end = min(width, split_points[i + 1])

            if x_end - x_start < 100:
                continue

            section_label = section_labels[i] if i < len(section_labels) else chr(ord('A') + i)
            output_name = f"{base_name}_{section_label}.png"
            output_path = output_dir / output_name

            if not dry_run:
                cropped = img.crop((x_start, 0, x_end, height))
                cropped.save(output_path)

            outputs.append({
                'name': output_name,
                'label': section_label
            })
    else:
        # 縦並び: y座標で分割（従来のロジック）
        split_points = [0]
        for label in labels:
            split_points.append(label['y_pixel'] - 40)
        split_points.append(height)

        section_labels = [header_sub or 'A']
        for label in labels:
            section_labels.append(label['label'])

        for i in range(len(split_points) - 1):
            y_start = split_points[i]
            y_end = split_points[i + 1]

            if y_end - y_start < 100:
                continue

            section_label = section_labels[i] if i < len(section_labels) else chr(ord('A') + i)
            output_name = f"{base_name}_{section_label}.png"
            output_path = output_dir / output_name

            if not dry_run:
                cropped = img.crop((0, y_start, width, y_end))
                cropped.save(output_path)

            outputs.append({
                'name': output_name,
                'label': section_label
            })

    return outputs


def process_kai(kai, dry_run=True):
    """指定回次の別冊を処理"""
    print(f"\n{'='*50}")
    print(f"第{kai}回 別冊画像抽出 v2 {'(dry-run)' if dry_run else ''}")
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

        temp_prefix = temp_dir / f"{kai}{section}_page"

        if not dry_run:
            cmd = [
                "pdftoppm", "-png", "-r", "300",
                str(pdf_path), str(temp_prefix)
            ]
            subprocess.run(cmd, capture_output=True)

        page_files = sorted(temp_dir.glob(f"{kai}{section}_page-*.png")) if temp_dir.exists() else []

        for page_file in page_files:
            rotation_angle = None
            ocr_results, was_rotated = ocr_image(page_file)
            header = extract_header_info(ocr_results)

            # ヘッダーが読めなかった場合、-90度回転して再試行
            if not header:
                ocr_results, was_rotated = ocr_image(page_file, rotated=True, angle=-90)
                header = extract_header_info(ocr_results)
                if header:
                    rotation_angle = -90

            # それでも読めなければ+90度回転
            if not header:
                ocr_results, was_rotated = ocr_image(page_file, rotated=True, angle=90)
                header = extract_header_info(ocr_results)
                if header:
                    rotation_angle = 90

            # 白紙・表紙ページの判定
            all_texts = ' '.join([r['text'] for r in ocr_results])

            # 白紙判定（「余白」「余 白」など）
            is_blank = '余' in all_texts and '白' in all_texts

            # 表紙判定（「別冊」「歯科医師」「国家試験」など）
            is_cover = any(kw in all_texts for kw in ['別冊', '歯科医師', '国家試験', '厚生労働省'])

            if is_blank:
                print(f"  {page_file.name} → スキップ（白紙ページ）")
                continue

            if is_cover:
                print(f"  {page_file.name} → スキップ（表紙ページ）")
                continue

            # ヘッダーが読めない場合もページ番号ベースで保存
            if not header:
                # ページ番号を抽出（例: 107B_page-36.png → 36）
                page_num = int(page_file.stem.split('-')[-1])
                fallback_name = f"{kai}{section}_page{page_num:02d}_unknown.png"
                fallback_path = output_dir / fallback_name
                print(f"  {page_file.name} → {fallback_name}（ヘッダー読み取り失敗・要確認）")

                if not dry_run:
                    from PIL import Image as PILImage
                    if rotation_angle:
                        pil_img = PILImage.open(page_file)
                        pil_img = pil_img.rotate(rotation_angle, expand=True)
                        pil_img.save(fallback_path)
                    else:
                        shutil.copy(page_file, fallback_path)

                total_count += 1
                continue

            inner_labels = find_section_labels(ocr_results)
            base_name = f"{kai}{header['section']}{header['mondai']}"

            if inner_labels:
                outputs = split_image_by_labels(
                    page_file, inner_labels, output_dir, base_name,
                    header['sub'], dry_run, rotation_angle
                )
                for out in outputs:
                    print(f"  {page_file.name} → {out['name']}" + (" (回転)" if rotation_angle else ""))
                    total_count += 1
            else:
                if header['sub']:
                    new_name = f"{base_name}_{header['sub']}.png"
                else:
                    new_name = f"{base_name}.png"

                new_path = output_dir / new_name
                print(f"  {page_file.name} → {new_name}" + (" (回転)" if rotation_angle else ""))

                if not dry_run:
                    from PIL import Image as PILImage
                    if rotation_angle:
                        pil_img = PILImage.open(page_file)
                        pil_img = pil_img.rotate(rotation_angle, expand=True)
                        pil_img.save(new_path)
                    else:
                        shutil.copy(page_file, new_path)

                total_count += 1

    if not dry_run and temp_dir.exists():
        shutil.rmtree(temp_dir)

    print(f"\n完了: {total_count}件")
    return total_count


def main():
    import argparse
    parser = argparse.ArgumentParser(description='別冊画像抽出 v2')
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
        print("  python3 extract_bessatsu_v2.py --kai 107 --dry-run")
        print("  python3 extract_bessatsu_v2.py --kai 107")


if __name__ == "__main__":
    main()
