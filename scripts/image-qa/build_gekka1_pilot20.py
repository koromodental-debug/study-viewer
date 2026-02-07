#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import csv
import json
import re
from pathlib import Path


QUESTION_PATH = Path("questions.json")
ANALYSIS_PATH = Path("data/gekka1_image_question_analysis.jsonl")
IMAGE_ROOT = Path("/Users/saitouryuuichi/Desktop/国試データベース/国家試験過去問/国試画像まとめ")

OUT_JSONL = Path("data/gekka1_pilot_qa_20_kokushi_images.jsonl")
OUT_TXT = Path("data/gekka1_pilot_qa_20_kokushi_images.txt")
OUT_HTML = Path("data/gekka1_pilot_qa_20_kokushi_images.html")
OUT_EVAL = Path("data/gekka1_pilot_qa_20_eval_sheet.csv")


def load_questions():
    obj = json.loads(QUESTION_PATH.read_text(encoding="utf-8"))
    return {q["id"]: q for q in obj.get("questions", []) if q.get("id")}


def load_analysis():
    rows = []
    with ANALYSIS_PATH.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def norm_answer(a):
    if not a:
        return ""
    s = str(a).strip().upper()
    s = "".join(ch for ch in s if ch in "ABCDE")
    return s


def pick_image_for_code(code: str):
    # exact-like match: stem starts with code and then separator/end
    pat = re.compile(rf"^{re.escape(code)}($|[^0-9A-Za-z])")
    cands = []
    for p in IMAGE_ROOT.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
            continue
        if pat.match(p.stem):
            cands.append(p)
    if not cands:
        return None
    # prefer combined images first (ab/abc), then shorter name.
    cands.sort(key=lambda x: (0 if re.search(r"(ab|abc|abcd)$", x.stem, re.I) else 1, len(x.name)))
    return str(cands[0])


def pick_axis(question_text: str, ask_keywords):
    t = question_text or ""
    if "目的" in t:
        return "処置目的"
    if "疑われる" in t or "診断" in t or "確定" in "".join(ask_keywords):
        return "診断"
    if "必要" in t or "行う" in t or "優先" in "".join(ask_keywords):
        return "次の一手"
    if "所見" in t:
        return "所見同定"
    return "所見同定"


def score_candidate(q, analysis_row, image_path):
    score = 0
    if q.get("hasFigure"):
        score += 3
    if image_path:
        score += 3
    if analysis_row.get("finding_keywords"):
        score += 2
    if analysis_row.get("ask_keywords"):
        score += 1
    ans = norm_answer(q.get("answer"))
    if len(ans) == 1:
        score += 2
    return score


def build_cards(limit=20):
    qmap = load_questions()
    analysis = load_analysis()
    cands = []

    for r in analysis:
        code = r.get("problem_code", "")
        q = qmap.get(code)
        if not q:
            continue
        ans = norm_answer(q.get("answer"))
        if len(ans) != 1:
            continue
        choices = q.get("choices", {})
        if not isinstance(choices, dict) or len(choices) < 4:
            continue
        # normalize keys to uppercase A-E
        ch = {}
        for k, v in choices.items():
            kk = str(k).strip().upper()
            if kk in "ABCDE":
                ch[kk] = str(v)
        if ans not in ch:
            continue
        image_path = pick_image_for_code(code)
        if not image_path:
            continue
        sc = score_candidate(q, r, image_path)
        cands.append((sc, code, q, r, image_path, ch, ans))

    cands.sort(key=lambda x: (x[0], int(str(x[2].get("year", 0)))), reverse=True)
    seen = set()
    cards = []
    for sc, code, q, r, image_path, ch, ans in cands:
        if code in seen:
            continue
        seen.add(code)
        qt = str(q.get("questionText", "")).replace("\n", " ").strip()
        axis = pick_axis(qt, r.get("ask_keywords", []))
        hint = "、".join(r.get("finding_keywords", [])[:4]) or "画像所見"
        cards.append(
            {
                "card_id": f"gekka1-{code}",
                "question_id": code,
                "year": q.get("year"),
                "decision_axis": axis,
                "image_path": image_path,
                "stem": qt,
                "choices": ch,
                "correct": ans,
                "answer": ch.get(ans, ""),
                "evidence_hint": hint,
                "quality_score": sc,
            }
        )
        if len(cards) >= limit:
            break
    return cards


def evaluate_card(c):
    reasons = []
    if c.get("decision_axis") in {"診断", "次の一手", "処置目的"}:
        reasons.append("判断軸が明確")
    if c.get("evidence_hint"):
        reasons.append("所見ヒントあり")
    if c.get("image_path"):
        reasons.append("国試画像リンクあり")
    if c.get("stem") and ("図" in c.get("stem") or "別冊" in c.get("stem")):
        reasons.append("画像依存の文脈")
    n = len(reasons)
    grade = "A" if n >= 4 else ("B" if n >= 3 else "C")
    return grade, " / ".join(reasons)


def write_outputs(cards):
    OUT_JSONL.parent.mkdir(parents=True, exist_ok=True)
    with OUT_JSONL.open("w", encoding="utf-8") as f:
        for c in cards:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")

    with OUT_TXT.open("w", encoding="utf-8") as f:
        for i, c in enumerate(cards, 1):
            f.write(f"[{i}] {c['question_id']} ({c['decision_axis']})\n")
            f.write(f"問題文: {c['stem']}\n")
            f.write(f"正答: {c['correct']} {c['answer']}\n")
            f.write(f"画像: {c['image_path']}\n")
            f.write(f"所見ヒント: {c['evidence_hint']}\n\n")

    # Simple HTML preview.
    parts = []
    for i, c in enumerate(cards, 1):
        lis = "".join([f"<li><b>{k}</b>: {v}</li>" for k, v in sorted(c["choices"].items())])
        parts.append(
            f"<article class='card'><h2>{i}. {c['question_id']} ({c['decision_axis']})</h2>"
            f"<img src='file://{c['image_path']}' alt='{c['question_id']}'/>"
            f"<p><b>Q:</b> {c['stem']}</p><ul>{lis}</ul>"
            f"<p><b>正答:</b> {c['correct']} {c['answer']}</p>"
            f"<p><b>所見ヒント:</b> {c['evidence_hint']}</p></article>"
        )
    html = (
        "<!doctype html><html lang='ja'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>外科1 20枚</title><style>"
        "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f7fb;margin:0}"
        "main{max-width:980px;margin:0 auto;padding:16px;display:grid;gap:12px}"
        ".card{background:#fff;border:1px solid #d9e0ea;border-radius:10px;padding:14px}"
        "img{max-width:100%;height:auto;display:block;margin:8px 0}</style></head>"
        f"<body><main>{''.join(parts)}</main></body></html>"
    )
    OUT_HTML.write_text(html, encoding="utf-8")

    # A/B/C sheet.
    with OUT_EVAL.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "card_id",
                "question_id",
                "decision_axis",
                "problem_text",
                "correct",
                "correct_text",
                "auto_grade",
                "auto_reason",
                "review_grade",
                "review_note",
            ]
        )
        for c in cards:
            g, reason = evaluate_card(c)
            w.writerow(
                [
                    c["card_id"],
                    c["question_id"],
                    c["decision_axis"],
                    c["stem"],
                    c["correct"],
                    c["answer"],
                    g,
                    reason,
                    "",
                    "",
                ]
            )


def main():
    cards = build_cards(limit=20)
    write_outputs(cards)
    print(f"cards={len(cards)}")
    print(f"wrote: {OUT_JSONL}")
    print(f"wrote: {OUT_TXT}")
    print(f"wrote: {OUT_HTML}")
    print(f"wrote: {OUT_EVAL}")


if __name__ == "__main__":
    main()
