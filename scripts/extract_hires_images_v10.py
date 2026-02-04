#!/usr/bin/env python3
"""
高解像度別冊画像から個別写真を切り抜くスクリプト v10

改善: macOS Vision APIで画像ヘッダーから問題番号を直接読み取って命名
"""

import re
from pathlib import Path
from PIL import Image
import numpy as np
import cv2
import tempfile
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
KAKOMON_DIR = BASE_DIR / "国家試験過去問"


def extract_question_number_vision(img_path, section):
    """macOS Vision APIで画像から問題番号を抽出

    ヘッダー形式: "（A 問題 XX）" または "(A 問題 XX)"
    返り値: 問題番号 (例: 83) または None
    """
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

            # 全テキストを結合してパターンマッチ
            all_texts = []
            for obs in results:
                text = obs.topCandidates_(1)[0].string()
                all_texts.append(text)

            combined_text = ' '.join(all_texts)

            # パターン1: 結合テキストから検索
            patterns = [
                rf'[（(]\s*{section}\s*問題\s*(\d+)\s*[）)]',
                rf'{section}\s*問題\s*(\d+)',
                rf'問題\s*(\d+)\s*[）)]',  # "問題 72 ）" のような断片
            ]

            for pattern in patterns:
                match = re.search(pattern, combined_text)
                if match:
                    return int(match.group(1))

            # パターン2: セクション確認後、「問題 XX」を探す
            has_section = any(section in t for t in all_texts)
            if has_section:
                for text in all_texts:
                    match = re.search(r'問題\s*(\d+)', text)
                    if match:
                        return int(match.group(1))

    except Exception as e:
        pass

    return None


def is_blank_page(gray):
    return np.mean(gray > 250) > 0.95


def find_label_positions(gray, white_threshold=240):
    """「A」「B」などの単独ラベル行を検出"""
    h, w = gray.shape
    header_end = int(h * 0.06)
    footer_start = int(h * 0.96)

    label_positions = []

    y = header_end
    while y < footer_start:
        row = gray[y, :]
        non_white = np.where(row < white_threshold)[0]

        if len(non_white) > 0:
            content_width = non_white[-1] - non_white[0]
            content_center = (non_white[0] + non_white[-1]) / 2

            if content_width < w * 0.05 and w * 0.40 < content_center < w * 0.60:
                label_top = y
                label_bottom = y

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

                if 15 < label_bottom - label_top < 80:
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


def get_content_bounds(
    gray,
    y1,
    y2,
    white_threshold=240,
    left_ignore_ratio=0.06,
    footer_ratio=0.96,
    margin=20,
):
    """指定範囲内のコンテンツ境界を取得"""
    h, w = gray.shape
    footer_y = int(h * footer_ratio)
    actual_y2 = min(y2, footer_y)

    left_ignore = int(w * left_ignore_ratio)
    region = gray[y1:actual_y2, left_ignore:]

    row_has_content = np.mean(region < white_threshold, axis=1) > 0.005
    col_has_content = np.mean(region < white_threshold, axis=0) > 0.005

    rows = np.where(row_has_content)[0]
    cols = np.where(col_has_content)[0]

    if len(rows) == 0 or len(cols) == 0:
        return None

    return (
        max(0, left_ignore + cols[0] - margin),
        y1 + rows[0],
        min(w, left_ignore + cols[-1] + margin),
        y1 + rows[-1] + margin
    )


def trim_bottom_whitespace(img_pil, white_threshold=240, bottom_ratio=0.04):
    """画像下部の余白とフッターを除去"""
    img_array = np.array(img_pil.convert('L'))
    h, w = img_array.shape

    footer_start = int(h * (1.0 - bottom_ratio))
    footer_region = img_array[footer_start:h, :]
    white_ratio = np.mean(footer_region > white_threshold)

    if white_ratio > 0.85:
        return img_pil.crop((0, 0, w, footer_start))
    return img_pil


def crop_page_margins(img_pil, left_ratio=0.06, top_ratio=0.02, bottom_ratio=0.04):
    w, h = img_pil.size
    left = int(w * left_ratio)
    top = int(h * top_ratio)
    bottom = int(h * (1.0 - bottom_ratio))
    if bottom <= top + 10:
        return img_pil
    return img_pil.crop((left, top, w, bottom))


def rotate_if_landscape(img_cv):
    h, w = img_cv.shape[:2]
    if w > h:
        img_cv = cv2.rotate(img_cv, cv2.ROTATE_90_COUNTERCLOCKWISE)
        return img_cv, True
    return img_cv, False


def validate_portrait_size(img_cv, basename):
    h, w = img_cv.shape[:2]
    if not (1600 <= w <= 2000 and 2400 <= h <= 2700):
        print(f"  [{basename}] 注意: 想定外サイズ {w}x{h}")


def try_ocr_question_on_image(img_cv_rgb, section):
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        Image.fromarray(img_cv_rgb).save(tmp.name)
        return extract_question_number_vision(tmp.name, section)


def normalize_orientation_with_ocr(img_cv_bgr, section):
    """OCRで問題番号を読める向きを選ぶ"""
    candidates = [
        ("orig", img_cv_bgr),
        ("ccw", cv2.rotate(img_cv_bgr, cv2.ROTATE_90_COUNTERCLOCKWISE)),
        ("cw", cv2.rotate(img_cv_bgr, cv2.ROTATE_90_CLOCKWISE)),
        ("180", cv2.rotate(img_cv_bgr, cv2.ROTATE_180)),
    ]

    for _, img_bgr in candidates:
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        qnum = try_ocr_question_on_image(img_rgb, section)
        if qnum is not None:
            return img_bgr, qnum

    return img_cv_bgr, None


def crop_five_photo_set(
    img_pil,
    white_threshold=240,
    min_area_ratio=0.01,
    aspect_min=0.5,
    aspect_max=3.5,
    left_ignore_ratio=0.06,
    bottom_ratio=0.04,
):
    def find_bottom_cut(gray, white_thresh=245, min_band_ratio=0.02, start_ratio=0.60):
        h = gray.shape[0]
        row_white = np.mean(gray > white_thresh, axis=1)
        in_band = False
        band_start = 0
        for y, ratio in enumerate(row_white):
            if ratio > 0.99:
                if not in_band:
                    in_band = True
                    band_start = y
            else:
                if in_band:
                    band_end = y
                    band_len = band_end - band_start
                    if band_start > int(h * start_ratio) and band_len > int(h * min_band_ratio):
                        # Confirm a wide, large content block exists below (profile A)
                        below = gray[band_end:, :]
                        if below.size == 0:
                            return None
                        mask = below < white_thresh
                        if np.mean(mask) < 0.01:
                            return None
                        ys, xs = np.where(mask)
                        if len(xs) == 0:
                            return None
                        bw = xs.max() - xs.min() + 1
                        bh = ys.max() - ys.min() + 1
                        width_ratio = bw / below.shape[1]
                        height_ratio = bh / below.shape[0]
                        if width_ratio > 0.7 and height_ratio > 0.12:
                            return band_start
                    in_band = False
        if in_band:
            band_end = h
            band_len = band_end - band_start
            if band_start > int(h * start_ratio) and band_len > int(h * min_band_ratio):
                below = gray[band_start:, :]
                mask = below < white_thresh
                if np.mean(mask) < 0.01:
                    return None
                ys, xs = np.where(mask)
                if len(xs) == 0:
                    return None
                bw = xs.max() - xs.min() + 1
                bh = ys.max() - ys.min() + 1
                width_ratio = bw / below.shape[1]
                height_ratio = bh / below.shape[0]
                if width_ratio > 0.7 and height_ratio > 0.12:
                    return band_start
        return None

    gray = np.array(img_pil.convert('L'))
    h, w = gray.shape

    left_ignore = int(w * left_ignore_ratio)
    bottom_limit = int(h * (1.0 - bottom_ratio))
    cut = find_bottom_cut(gray)
    if cut is not None:
        bottom_limit = min(bottom_limit, cut)
    work = gray[:bottom_limit, left_ignore:]

    mask = (work < white_threshold).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    work_area = work.shape[0] * work.shape[1]

    boxes = []
    for i in range(1, num_labels):
        x, y, bw, bh, area = stats[i]
        if area < work_area * min_area_ratio:
            continue
        if bh == 0:
            continue
        aspect = bw / bh
        if not (aspect_min <= aspect <= aspect_max):
            continue
        boxes.append((x, y, bw, bh, area))

    # bottom_limit already adjusted by profile-aware cut

    if len(boxes) < 5:
        # Fallback: crop by content bounds within the upper region to remove labels/footer
        row_has = np.mean(work < white_threshold, axis=1) > 0.003
        col_has = np.mean(work < white_threshold, axis=0) > 0.003
        rows = np.where(row_has)[0]
        cols = np.where(col_has)[0]
        if len(rows) == 0 or len(cols) == 0:
            return img_pil
        x1 = max(0, left_ignore + cols[0] - 10)
        x2 = min(w, left_ignore + cols[-1] + 10)
        y1 = max(0, rows[0] - 10)
        y2 = min(bottom_limit, rows[-1] + 10)
        if (x2 - x1) < 50 or (y2 - y1) < 50:
            return img_pil
        return img_pil.crop((x1, y1, x2, y2))

    if len(boxes) > 5:
        # Prefer the upper 5 photos; drop the lower profile (A) when present
        boxes = sorted(boxes, key=lambda b: (b[1] + b[3] / 2))[:5]

    x1 = min(b[0] for b in boxes)
    y1 = min(b[1] for b in boxes)
    x2 = max(b[0] + b[2] for b in boxes)
    y2 = max(b[1] + b[3] for b in boxes)

    x1 = max(0, left_ignore + x1)
    x2 = min(w, left_ignore + x2)
    y1 = max(0, y1)
    y2 = min(bottom_limit, y2)

    return img_pil.crop((x1, y1, x2, y2))


def split_page(img_array, max_regions=10):
    """ページをラベル基準で分割"""
    h, w = img_array.shape[:2]

    if len(img_array.shape) == 3:
        gray = cv2.cvtColor(img_array, cv2.COLOR_RGB2GRAY)
    else:
        gray = img_array

    if is_blank_page(gray):
        return []

    header_end = int(h * 0.06)
    footer_start = int(h * 0.91)

    labels = find_label_positions(gray)

    # フッター領域のラベルを除外（ページ番号の誤検出防止）
    labels = [(t, b) for t, b in labels if t < footer_start]

    regions = []

    if len(labels) == 0:
        bounds = get_content_bounds(gray, header_end, footer_start)
        if bounds:
            regions.append(bounds)

    elif len(labels) == 1:
        label_top, label_bottom = labels[0]
        bounds = get_content_bounds(gray, label_top - 10, footer_start)
        if bounds:
            x1, y1, x2, y2 = bounds
            y1 = min(y1, label_top - 5)
            regions.append((x1, y1, x2, y2))

    else:
        for i, (label_top, label_bottom) in enumerate(labels):
            if i + 1 < len(labels):
                end_y = labels[i + 1][0] - 10
            else:
                end_y = footer_start

            bounds = get_content_bounds(gray, label_top - 10, end_y)
            if bounds:
                x1, y1, x2, y2 = bounds
                y1 = min(y1, label_top - 5)
                y2 = min(y2, end_y)
                regions.append((x1, y1, x2, y2))

    if len(regions) > max_regions:
        regions = regions[:max_regions]

    return regions


def extract_images_for_kai(kai, dry_run=False, output_dir_override=None, bessatsu_dir_override=None):
    print(f"\n{'='*50}")
    print(f"第{kai}回 画像抽出 (v10 - Vision OCR命名)")
    print(f"{'='*50}")

    if not HAS_VISION:
        print("エラー: macOS Vision APIが必要です")
        return 0, 0

    if bessatsu_dir_override is not None:
        bessatsu_dir = Path(bessatsu_dir_override)
    else:
        bessatsu_dir = KAKOMON_DIR / f"{kai}回" / "別冊"
    if not bessatsu_dir.exists():
        print(f"別冊ディレクトリなし: {bessatsu_dir}")
        return 0, 0

    if output_dir_override is not None:
        output_dir = Path(output_dir_override)
    else:
        output_dir = KAKOMON_DIR / f"{kai}回" / "切り抜き"
    if not dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    processed = 0
    skipped = 0
    ocr_failed = 0

    # 問題コードごとの画像カウント（重複回避用）
    code_counts = {}

    # Prefer renamed files if present
    kai_str = str(kai)
    renamed_files = sorted(bessatsu_dir.glob(f"{kai_str}[ABCD]_問題*.png"))
    if renamed_files:
        section_groups = {s: [] for s in ['A', 'B', 'C', 'D']}
        for p in renamed_files:
            stem = p.stem
            if not stem.startswith(kai_str) or len(stem) <= len(kai_str):
                continue
            section = stem[len(kai_str)]
            if section in section_groups:
                section_groups[section].append(p)
    else:
        section_groups = {}
        for section in ['A', 'B', 'C', 'D']:
            files = sorted(bessatsu_dir.glob(f"{kai}{section}_別冊*.png"))
            if files:
                section_groups[section] = files

    for section, section_files in section_groups.items():
        if not section_files:
            continue

        print(f"\n--- {kai}{section} ({len(section_files)}ファイル) ---")

        for bessatsu_file in section_files:
            img_cv = cv2.imread(str(bessatsu_file))
            if img_cv is None:
                skipped += 1
                continue

            # Prefer file name when already renamed as *_問題XX.png
            from_filename = False
            m = re.search(rf'{kai}{section}_問題(\d+)', bessatsu_file.stem)
            if m:
                question_num = int(m.group(1))
                from_filename = True
            else:
                img_cv, question_num = normalize_orientation_with_ocr(img_cv, section)

            img_cv = cv2.cvtColor(img_cv, cv2.COLOR_BGR2RGB)
            validate_portrait_size(img_cv, bessatsu_file.name)
            gray = cv2.cvtColor(img_cv, cv2.COLOR_RGB2GRAY)

            if is_blank_page(gray):
                if from_filename and question_num is not None:
                    code = f"{kai}{section}{question_num}"
                    img_pil = Image.fromarray(img_cv)
                    cropped = crop_page_margins(img_pil)
                    cropped = trim_bottom_whitespace(cropped)
                    if cropped.width >= 50 and cropped.height >= 50:
                        if code not in code_counts:
                            code_counts[code] = 0
                        code_counts[code] += 1
                        count = code_counts[code]
                        fname = f"{code}.png" if count == 1 else f"{code}_{count}.png"
                        output_path = output_dir / fname
                        if not dry_run:
                            cropped.save(output_path)
                        print(f"  [{code}] → {fname} {cropped.size} (blank)")
                        processed += 1
                    else:
                        skipped += 1
                continue

            if question_num is None:
                print(f"  [{bessatsu_file.name}] 問題番号検出失敗 → unknownとして保存")
                ocr_failed += 1
                code = f"{kai}{section}_unknown_{bessatsu_file.stem}"
            else:
                code = f"{kai}{section}{question_num}"

            img_pil = Image.fromarray(img_cv)

            # 領域分割
            regions = split_page(img_cv, max_regions=10)

            if len(regions) == 0:
                print(f"  [{code}] 領域なし → ページ全体を保存")
                cropped = crop_page_margins(img_pil)
                cropped = trim_bottom_whitespace(cropped)
                if cropped.width >= 50 and cropped.height >= 50:
                    if code not in code_counts:
                        code_counts[code] = 0
                    code_counts[code] += 1
                    count = code_counts[code]
                    fname = f"{code}.png" if count == 1 else f"{code}_{count}.png"
                    output_path = output_dir / fname
                    if not dry_run:
                        cropped.save(output_path)
                    print(f"  [{code}] → {fname} {cropped.size}")
                    processed += 1
                else:
                    skipped += 1
                continue

            saved_any = False
            for i, (x1, y1, x2, y2) in enumerate(regions):
                cropped = img_pil.crop((x1, y1, x2, y2))
                cropped = trim_bottom_whitespace(cropped)
                cropped = crop_five_photo_set(cropped)

                if cropped.width < 50 or cropped.height < 50:
                    skipped += 1
                    continue

                # 重複回避: カウントを使って連番付与
                if code not in code_counts:
                    code_counts[code] = 0
                code_counts[code] += 1

                count = code_counts[code]
                if count == 1:
                    fname = f"{code}.png"
                else:
                    fname = f"{code}_{count}.png"

                output_path = output_dir / fname

                if not dry_run:
                    cropped.save(output_path)
                print(f"  [{code}] → {fname} {cropped.size}")
                processed += 1
                saved_any = True

            if not saved_any:
                print(f"  [{code}] 画像保存なし → ページ全体を保存")
                cropped = crop_page_margins(img_pil)
                cropped = trim_bottom_whitespace(cropped)
                if cropped.width >= 50 and cropped.height >= 50:
                    if code not in code_counts:
                        code_counts[code] = 0
                    code_counts[code] += 1
                    count = code_counts[code]
                    fname = f"{code}.png" if count == 1 else f"{code}_{count}.png"
                    output_path = output_dir / fname
                    if not dry_run:
                        cropped.save(output_path)
                    print(f"  [{code}] → {fname} {cropped.size}")
                    processed += 1
                else:
                    skipped += 1

            # Final fallback: if nothing was saved for this code, copy original page
            if code_counts.get(code, 0) == 0:
                fname = f"{code}.png"
                output_path = output_dir / fname
                if not output_path.exists():
                    if not dry_run:
                        shutil.copy2(bessatsu_file, output_path)
                    print(f"  [{code}] → {fname} (原本コピー)")
                    processed += 1

    print(f"\n完了: {processed}枚、スキップ: {skipped}枚、OCR失敗: {ocr_failed}件")
    print(f"出力: {output_dir}")
    return processed, skipped


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('kai', type=int, nargs='?')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--out-dir', type=str, default=None)
    parser.add_argument('--bessatsu-dir', type=str, default=None)
    args = parser.parse_args()

    if args.all:
        for kai in range(102, 118):
            extract_images_for_kai(kai, args.dry_run, args.out_dir, args.bessatsu_dir)
    elif args.kai:
        extract_images_for_kai(args.kai, args.dry_run, args.out_dir, args.bessatsu_dir)
    else:
        print("python extract_hires_images_v10.py 117")


if __name__ == "__main__":
    main()
