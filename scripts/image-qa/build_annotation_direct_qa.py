#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import csv
import json
import re
from pathlib import Path


ANN_CSV = Path("/Users/saitouryuuichi/Desktop/国試データベース/解説PDF/画像診断_抽出/外科１/annotations.csv")
IMG_ROOT = Path("/Users/saitouryuuichi/Desktop/国試データベース/国家試験過去問/国試画像まとめ")
OUT_JSONL = Path("data/gekka1_annotation_direct_qa.jsonl")
OUT_TXT = Path("data/gekka1_annotation_direct_qa.txt")
OUT_HTML = Path("data/gekka1_annotation_direct_qa.html")


def clean(s: str) -> str:
    s = (s or "").replace("\u3000", " ").replace("\n", " ").strip()
    s = re.sub(r"\s+", " ", s)
    s = s.strip("、,・/ ")
    return s


def pick_image(code: str):
    pat = re.compile(rf"^{re.escape(code)}($|[^0-9A-Za-z])")
    cands = []
    for p in IMG_ROOT.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            continue
        if pat.match(p.stem):
            cands.append(p)
    if not cands:
        return None
    cands.sort(key=lambda x: (0 if re.search(r"(ab|abc|abcd)$", x.stem, re.I) else 1, len(x.name)))
    return str(cands[0])


def main():
    rows = []
    with ANN_CSV.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            code = clean(row.get("問題コード", ""))
            if not code:
                continue
            img_path = pick_image(code)
            for label in ["A", "B", "C", "D", "E"]:
                text = clean(row.get(f"画像{label}", ""))
                if not text:
                    continue
                qa = {
                    "card_id": f"ann-{code}-{label}",
                    "question_id": code,
                    "source": "画像診断_抽出/外科１/annotations.csv",
                    "image_path": img_path,
                    "question": f"図{label}で示される主所見として最も適切なのは何か。",
                    "answer": text,
                    "mode": "annotation_direct",
                }
                rows.append(qa)

    OUT_JSONL.parent.mkdir(parents=True, exist_ok=True)
    with OUT_JSONL.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    with OUT_TXT.open("w", encoding="utf-8") as f:
        for i, r in enumerate(rows, 1):
            f.write(f"[{i}] {r['question_id']} {r['card_id']}\n")
            f.write(f"Q: {r['question']}\n")
            f.write(f"A: {r['answer']}\n")
            if r.get("image_path"):
                f.write(f"画像: {r['image_path']}\n")
            f.write("\n")

    parts = []
    for i, r in enumerate(rows, 1):
        img = f"<img src='file://{r['image_path']}' alt='{r['card_id']}'/>" if r.get("image_path") else ""
        parts.append(
            f"<article class='card'><h2>{i}. {r['question_id']} ({r['card_id']})</h2>"
            f"{img}<p><b>Q:</b> {r['question']}</p><p><b>A:</b> {r['answer']}</p></article>"
        )
    html = (
        "<!doctype html><html lang='ja'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'><title>外科1 annotation direct QA</title>"
        "<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f7fb;margin:0}"
        "main{max-width:980px;margin:0 auto;padding:16px;display:grid;gap:12px}"
        ".card{background:#fff;border:1px solid #d9e0ea;border-radius:10px;padding:14px}"
        "img{max-width:100%;height:auto;display:block;margin:8px 0}</style></head>"
        f"<body><main>{''.join(parts)}</main></body></html>"
    )
    OUT_HTML.write_text(html, encoding="utf-8")

    print(f"cards={len(rows)}")
    print(f"wrote: {OUT_JSONL}")
    print(f"wrote: {OUT_TXT}")
    print(f"wrote: {OUT_HTML}")


if __name__ == "__main__":
    main()
