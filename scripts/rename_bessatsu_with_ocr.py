#!/usr/bin/env python3
"""
別冊PNGをOCRで問題番号にリネームする。
例: 107A_別冊05.png -> 107A_問題28.png
"""

import argparse
from pathlib import Path
import importlib.util
import shutil


SCRIPT_PATH = Path(__file__).resolve().parent / "extract_hires_images_v10.py"
spec = importlib.util.spec_from_file_location("extract", SCRIPT_PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def rename_files(bessatsu_dir: Path, out_dir: Path, dry_run: bool = True):
    changed = 0
    failed = 0
    if not dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    # 1st pass: OCRで問題番号を取得し、各問題に何枚あるかカウント
    file_info = []  # [(path, prefix, qnum), ...]
    qnum_count = {}  # {(prefix, qnum): count}

    for path in sorted(bessatsu_dir.glob("*.png")):
        name = path.name
        if "別冊" not in name:
            continue

        # detect section like 107A_別冊05.png
        stem = path.stem
        section = None
        for s in ["A", "B", "C", "D"]:
            if f"{s}_別冊" in stem or f"{s}別冊" in stem:
                section = s
                break
        if section is None:
            failed += 1
            print(f"[skip] section不明: {name}")
            continue

        # OCR with orientation normalization
        img_cv = mod.cv2.imread(str(path))
        if img_cv is None:
            failed += 1
            print(f"[skip] 読み込み失敗: {name}")
            continue

        img_cv, qnum = mod.normalize_orientation_with_ocr(img_cv, section)
        if qnum is None:
            failed += 1
            print(f"[skip] OCR失敗: {name}")
            continue

        prefix = stem.split("_別冊")[0]
        file_info.append((path, prefix, qnum))
        key = (prefix, qnum)
        qnum_count[key] = qnum_count.get(key, 0) + 1

    # 2nd pass: 連番を付けてリネーム
    qnum_idx = {}  # 現在の連番インデックス
    for path, prefix, qnum in file_info:
        key = (prefix, qnum)
        count = qnum_count[key]

        if count == 1:
            # 1枚だけなら連番なし
            new_name = f"{prefix}_問題{qnum:02d}.png"
        else:
            # 複数枚なら連番付き
            idx = qnum_idx.get(key, 1)
            qnum_idx[key] = idx + 1
            new_name = f"{prefix}_問題{qnum:02d}_{idx}.png"

        new_path = out_dir / new_name
        if new_path.exists():
            failed += 1
            print(f"[skip] 既存: {new_name}")
            continue

        if dry_run:
            print(f"[dry] {path.name} -> {new_name}")
        else:
            shutil.copy2(path, new_path)
            print(f"[ok]  {path.name} -> {new_name}")
            changed += 1

    print(f"\n完了: 変更 {changed}件 / 失敗 {failed}件")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dir", type=str, help="別冊フォルダ")
    parser.add_argument("--out-dir", type=str, required=True, help="出力フォルダ")
    parser.add_argument("--apply", action="store_true", help="実際にリネームする")
    args = parser.parse_args()

    bessatsu_dir = Path(args.dir)
    if not bessatsu_dir.exists():
        print(f"フォルダがありません: {bessatsu_dir}")
        return

    out_dir = Path(args.out_dir)
    rename_files(bessatsu_dir, out_dir, dry_run=not args.apply)


if __name__ == "__main__":
    main()
