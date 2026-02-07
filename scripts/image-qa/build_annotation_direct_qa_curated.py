#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import csv
import json
import re
from pathlib import Path


ANN_CSV = Path("/Users/saitouryuuichi/Desktop/国試データベース/解説PDF/画像診断_抽出/外科１/annotations.csv")
IMG_ROOT = Path("/Users/saitouryuuichi/Desktop/国試データベース/国家試験過去問/国試画像まとめ")

OUT_JSONL = Path("data/gekka1_annotation_direct_qa_curated.jsonl")
OUT_TXT = Path("data/gekka1_annotation_direct_qa_curated.txt")
OUT_HTML = Path("data/gekka1_annotation_direct_qa_curated.html")
OUT_REPORT = Path("data/gekka1_annotation_quality_report.csv")


MED_HINTS = [
    "透過像", "不透過像", "境界明瞭", "境界不明瞭", "単房性", "多房性", "蜂巣状", "すりガラス",
    "石灰化", "歯根吸収", "腫脹", "発赤", "潰瘍", "白斑", "硬結", "CT", "MRI", "病理", "組織像",
    "ヨード不染域", "造影", "嚢胞", "リンパ節",
]

NOISE_PATTERNS = [
    r"0ク",
    r"11\s*2",
    r"扁¥",
    r"8］",
    r"解してほしい",
    r"、、",
]


def clean_text(s: str) -> str:
    s = (s or "").replace("\u3000", " ").replace("\n", " ").strip()
    s = re.sub(r"\s+", " ", s)
    s = s.replace("、、", "、")
    s = s.strip("、,・/ ")
    return s


def image_path_for(code: str):
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
        return ""
    cands.sort(key=lambda x: (0 if re.search(r"(ab|abc|abcd)$", x.stem, re.I) else 1, len(x.name)))
    return str(cands[0])


def score_quality(t: str):
    n = len(t)
    if n == 0:
        return 0.0, ["empty"]
    weird = len(re.findall(r"[^\s一-龥ぁ-んァ-ヶA-Za-z0-9％%.,，、。:：;；()（）\-/+！？!?]", t))
    weird_ratio = weird / n
    reasons = []
    score = 1.0
    if n < 6:
        score -= 0.45
        reasons.append("too_short")
    if weird_ratio > 0.12:
        score -= 0.45
        reasons.append("symbol_noise")
    if any(re.search(p, t) for p in NOISE_PATTERNS):
        score -= 0.35
        reasons.append("pattern_noise")
    if not any(k in t for k in MED_HINTS):
        score -= 0.20
        reasons.append("low_medical_signal")
    return score, reasons


def grade(score: float):
    if score >= 0.75:
        return "A"
    if score >= 0.45:
        return "B"
    return "C"


def main():
    all_items = []
    with ANN_CSV.open("r", encoding="utf-8-sig", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            code = clean_text(row.get("問題コード", ""))
            if not code:
                continue
            img = image_path_for(code)
            for lab in ["A", "B", "C", "D", "E"]:
                raw = row.get(f"画像{lab}", "")
                txt = clean_text(raw)
                if not txt:
                    continue
                sc, reasons = score_quality(txt)
                g = grade(sc)
                all_items.append(
                    {
                        "problem_code": code,
                        "panel": lab,
                        "text": txt,
                        "score": round(sc, 3),
                        "grade": g,
                        "reasons": ",".join(reasons),
                        "image_path": img,
                    }
                )

    # Report for audit.
    OUT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    with OUT_REPORT.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["problem_code", "panel", "grade", "score", "reasons", "text", "image_path"])
        for x in all_items:
            w.writerow([x["problem_code"], x["panel"], x["grade"], x["score"], x["reasons"], x["text"], x["image_path"]])

    curated = [x for x in all_items if x["grade"] != "C"]
    # Build QA from A/B only.
    qas = []
    for x in curated:
        qas.append(
            {
                "card_id": f"annq-{x['problem_code']}-{x['panel']}",
                "question_id": x["problem_code"],
                "question": f"図{x['panel']}で示される主所見として最も適切なのは何か。",
                "answer": x["text"],
                "quality_grade": x["grade"],
                "quality_score": x["score"],
                "quality_flags": x["reasons"],
                "image_path": x["image_path"],
                "source": str(ANN_CSV),
            }
        )

    with OUT_JSONL.open("w", encoding="utf-8") as f:
        for q in qas:
            f.write(json.dumps(q, ensure_ascii=False) + "\n")

    with OUT_TXT.open("w", encoding="utf-8") as f:
        for i, q in enumerate(qas, 1):
            f.write(f"[{i}] {q['question_id']} ({q['quality_grade']})\n")
            f.write(f"Q: {q['question']}\n")
            f.write(f"A: {q['answer']}\n")
            f.write(f"画像: {q['image_path']}\n\n")

    parts = []
    for i, q in enumerate(qas, 1):
        img = f"<img src='file://{q['image_path']}' alt='{q['card_id']}'/>" if q.get("image_path") else ""
        parts.append(
            f"<article class='card'><h2>{i}. {q['question_id']} <span class='{q['quality_grade']}'>{q['quality_grade']}</span></h2>"
            f"{img}<p><b>Q:</b> {q['question']}</p><p><b>A:</b> {q['answer']}</p>"
            f"<p><small>score={q['quality_score']} flags={q['quality_flags']}</small></p></article>"
        )
    html = (
        "<!doctype html><html lang='ja'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'><title>外科1 annotation curated QA</title>"
        "<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f7fb;margin:0}"
        "main{max-width:980px;margin:0 auto;padding:16px;display:grid;gap:12px}"
        ".card{background:#fff;border:1px solid #d9e0ea;border-radius:10px;padding:14px}"
        ".A{color:#0f7a2f}.B{color:#b26a00}.C{color:#b91c1c}"
        "img{max-width:100%;height:auto;display:block;margin:8px 0}</style></head>"
        f"<body><main>{''.join(parts)}</main></body></html>"
    )
    OUT_HTML.write_text(html, encoding="utf-8")

    nA = sum(1 for x in all_items if x["grade"] == "A")
    nB = sum(1 for x in all_items if x["grade"] == "B")
    nC = sum(1 for x in all_items if x["grade"] == "C")
    print(f"all={len(all_items)} A={nA} B={nB} C={nC}")
    print(f"curated={len(qas)}")
    print(f"wrote: {OUT_JSONL}")
    print(f"wrote: {OUT_TXT}")
    print(f"wrote: {OUT_HTML}")
    print(f"wrote: {OUT_REPORT}")


if __name__ == "__main__":
    main()
