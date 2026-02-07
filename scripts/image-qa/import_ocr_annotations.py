#!/usr/bin/env python3
"""
Import OCR-derived annotations.csv files into image-qa candidate JSONL.

Input (default):
  ../解説PDF/画像診断_抽出/*/annotations.csv

Output (default):
  data/ocr_annotation_candidates.jsonl
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import re
from datetime import datetime, timezone
from pathlib import Path


CODE_RE = re.compile(r"^\d{3}[A-D]\d{1,3}$")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def split_findings(text: str) -> list[str]:
    if not text:
        return []
    # Normalize major separators commonly seen in OCR outputs.
    normalized = (
        text.replace("／", "\n")
        .replace("/", "\n")
        .replace("、", "\n")
        .replace("。", "\n")
    )
    parts = []
    for raw in normalized.splitlines():
        s = raw.strip()
        if not s:
            continue
        # Drop obvious OCR noise-only tokens.
        if re.fullmatch(r"[-・,.\s]+", s):
            continue
        if len(s) <= 1:
            continue
        parts.append(s)
    # Keep stable order while deduplicating.
    seen = set()
    out = []
    for p in parts:
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def infer_modality(type_text: str) -> str:
    t = (type_text or "").strip()
    if not t:
        return "不明"
    if "X線" in t or "レントゲン" in t:
        return "X線"
    if "CT" in t:
        return "CT"
    if "MRI" in t:
        return "MRI"
    if "顔貌" in t or "口腔内" in t or "写真" in t:
        return "写真"
    if "セファロ" in t:
        return "セファロ"
    return t


def build_question_image_map(questions_path: Path) -> dict[str, list[str]]:
    with questions_path.open(encoding="utf-8") as f:
        obj = json.load(f)
    out: dict[str, list[str]] = {}
    for q in obj.get("questions", []):
        qid = q.get("id")
        if not qid:
            continue
        images = [str(x).lstrip("/") for x in (q.get("images") or []) if x]
        out[qid] = images
    return out


def convert_one_csv(csv_path: Path, q_images: dict[str, list[str]]) -> list[dict]:
    rows = []
    subject = csv_path.parent.name
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            qid = (row.get("問題コード") or "").strip()
            if not CODE_RE.match(qid):
                continue

            for slot in ["A", "B", "C", "D", "E"]:
                key = f"画像{slot}"
                txt = (row.get(key) or "").strip()
                if not txt:
                    continue

                findings = split_findings(txt)
                if not findings:
                    continue

                type_key = f"画像{slot}タイプ"
                modality = infer_modality(row.get(type_key, ""))
                index = ord(slot) - ord("A")
                image_list = q_images.get(qid, [])
                image_relpath = image_list[index] if index < len(image_list) else ""

                candidate = {
                    "annotation_id": f"{qid}:{slot}:ocr",
                    "question_id": qid,
                    "image_id": f"{qid}_{slot}",
                    "image_slot": slot,
                    "image_relpath": image_relpath,
                    "year": int(qid[:3]),
                    "status": "draft",
                    "finding_tags": findings[:8],
                    "anatomy_tags": ["未確定部位"],
                    "modality_tags": [modality],
                    "summary_ja": f"{qid} 画像{slot} OCR所見候補",
                    "evidence_text": txt,
                    "confidence": 0.55,
                    "reviewer": None,
                    "review_comment": None,
                    "source": f"ocr:{subject}:{csv_path.name}",
                    "updated_at": now_iso(),
                }
                rows.append(candidate)
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--glob",
        default="../解説PDF/画像診断_抽出/*/annotations.csv",
        help="Glob for OCR annotation CSV files",
    )
    parser.add_argument(
        "--questions",
        default="questions.json",
        help="questions.json path",
    )
    parser.add_argument(
        "--out",
        default="data/ocr_annotation_candidates.jsonl",
        help="Output JSONL path",
    )
    args = parser.parse_args()

    csv_files = [Path(p) for p in sorted(glob.glob(args.glob))]
    if not csv_files:
        raise SystemExit(f"No files matched: {args.glob}")

    q_images = build_question_image_map(Path(args.questions))
    all_rows: list[dict] = []
    for p in csv_files:
        all_rows.extend(convert_one_csv(p, q_images))

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for r in all_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    linked = sum(1 for r in all_rows if r.get("image_relpath"))
    print(f"csv_files={len(csv_files)}")
    print(f"candidates={len(all_rows)}")
    print(f"linked_image_path={linked}")
    print(f"wrote={out_path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

