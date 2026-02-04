#!/usr/bin/env python3
"""
117回 別冊ファイル名修正スクリプト

問題: ファイル名の番号がフッターのページ番号と4ずれている
- ファイル 117A_別冊36.png → フッター "— 32 —"
- ファイル 117A_別冊14.png → フッター "— 10 —"

修正: ファイル番号から4を引く
"""

from pathlib import Path
import re
import shutil

BESSATSU_DIR = Path("/Users/saitouryuuichi/Desktop/国試データベース/国家試験過去問/117回/別冊")
BACKUP_DIR = BESSATSU_DIR / "_backup"

def fix_filenames(dry_run=True):
    if not BESSATSU_DIR.exists():
        print(f"ディレクトリが見つかりません: {BESSATSU_DIR}")
        return

    # バックアップ作成
    if not dry_run and not BACKUP_DIR.exists():
        BACKUP_DIR.mkdir()
        print(f"バックアップディレクトリ作成: {BACKUP_DIR}")

    files = sorted(BESSATSU_DIR.glob("117*_別冊*.png"))
    print(f"対象ファイル: {len(files)}件")

    rename_map = {}

    for f in files:
        match = re.match(r'(117[A-D])_別冊(\d+)\.png', f.name)
        if not match:
            continue

        section = match.group(1)
        old_num = int(match.group(2))
        new_num = old_num - 4

        if new_num < 1:
            print(f"  スキップ: {f.name} (新番号が0以下)")
            continue

        new_name = f"{section}_別冊{new_num:02d}.png"
        rename_map[f] = BESSATSU_DIR / new_name

    # 衝突チェック
    new_names = set(p.name for p in rename_map.values())
    if len(new_names) != len(rename_map):
        print("エラー: リネーム後のファイル名に重複があります")
        return

    # リネーム実行（一時ファイル経由で安全に）
    print(f"\n{'[DRY RUN] ' if dry_run else ''}リネーム計画:")

    for old_path, new_path in sorted(rename_map.items(), key=lambda x: x[0].name):
        print(f"  {old_path.name} → {new_path.name}")

    if dry_run:
        print(f"\n実行するには: python fix_117_filenames.py --execute")
        return

    # バックアップ
    print("\nバックアップ中...")
    for f in files:
        shutil.copy2(f, BACKUP_DIR / f.name)
    print(f"バックアップ完了: {BACKUP_DIR}")

    # 一時名にリネーム（衝突回避）
    print("\nリネーム中...")
    temp_map = {}
    for old_path in rename_map:
        temp_path = old_path.with_suffix('.tmp')
        old_path.rename(temp_path)
        temp_map[temp_path] = rename_map[old_path]

    # 最終名にリネーム
    for temp_path, new_path in temp_map.items():
        temp_path.rename(new_path)

    print(f"リネーム完了: {len(rename_map)}件")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true', help='実際にリネームを実行')
    args = parser.parse_args()

    fix_filenames(dry_run=not args.execute)
