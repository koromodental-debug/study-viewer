#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
from pathlib import Path


IN_PATH = Path("data/gekka1_pilot_qa_20_kokushi_images.jsonl")
OUT_JSONL = Path("data/gekka1_imagefirst_qa_20.jsonl")
OUT_TXT = Path("data/gekka1_imagefirst_qa_20.txt")
OUT_HTML = Path("data/gekka1_imagefirst_qa_20.html")


def infer_axis(axis: str, answer: str):
    a = answer or ""
    # Treatment/action-like answers should not be asked as diagnosis.
    if any(k in a for k in ["切除", "治療", "摘出", "生検", "経過観察", "投与", "処置"]):
        return "次の一手"
    return axis or "診断"


def build_stem(axis: str, hint: str):
    if axis == "診断":
        return f"図を示す。主所見（{hint}）に最も整合する診断はどれか。1つ選べ。"
    if axis == "次の一手":
        return f"図を示す。主所見（{hint}）に基づき、最初に選ぶべき対応はどれか。1つ選べ。"
    if axis == "処置目的":
        return f"図を示す。この所見で行う操作の目的として最も適切なのはどれか。1つ選べ。"
    return f"図を示す。主所見（{hint}）として最も適切なのはどれか。1つ選べ。"


def build_observation(hint: str):
    toks = [x for x in (hint or "").split("、") if x]
    if not toks:
        return "画像の形態・濃度・境界の一致を優先して判断する。"
    return "観察ポイント: " + " / ".join(toks[:4])


def main():
    rows = []
    with IN_PATH.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))

    out = []
    for r in rows:
        axis = infer_axis(r.get("decision_axis", "診断"), r.get("answer", ""))
        hint = r.get("evidence_hint", "画像所見")
        nr = dict(r)
        nr["source_mode"] = "image_first"
        nr["decision_axis"] = axis
        nr["stem"] = build_stem(axis, hint)
        nr["observation"] = build_observation(hint)
        nr["quality_note"] = "原問題文を使わず、画像所見ベースで再構成"
        out.append(nr)

    with OUT_JSONL.open("w", encoding="utf-8") as f:
        for r in out:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    with OUT_TXT.open("w", encoding="utf-8") as f:
        for i, r in enumerate(out, 1):
            c = r["correct"]
            ans = r["choices"].get(c, "")
            f.write(f"[{i}] {r['question_id']} ({r['decision_axis']})\n")
            f.write(f"問題文: {r['stem']}\n")
            f.write(f"{r['observation']}\n")
            f.write(f"正答: {c} {ans}\n")
            f.write(f"画像: {r['image_path']}\n\n")

    parts = []
    for i, r in enumerate(out, 1):
        lis = "".join([f"<li><b>{k}</b>: {v}</li>" for k, v in sorted(r["choices"].items())])
        c = r["correct"]
        ans = r["choices"].get(c, "")
        parts.append(
            f"<article class='card'><h2>{i}. {r['question_id']} ({r['decision_axis']})</h2>"
            f"<img src='file://{r['image_path']}' alt='{r['question_id']}'/>"
            f"<p><b>Q:</b> {r['stem']}</p><p>{r['observation']}</p><ul>{lis}</ul>"
            f"<p><b>正答:</b> {c} {ans}</p></article>"
        )
    html = (
        "<!doctype html><html lang='ja'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'><title>外科1 image-first 20</title>"
        "<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f7fb;margin:0}"
        "main{max-width:980px;margin:0 auto;padding:16px;display:grid;gap:12px}"
        ".card{background:#fff;border:1px solid #d9e0ea;border-radius:10px;padding:14px}"
        "img{max-width:100%;height:auto;display:block;margin:8px 0}</style></head>"
        f"<body><main>{''.join(parts)}</main></body></html>"
    )
    OUT_HTML.write_text(html, encoding="utf-8")

    print(f"cards={len(out)}")
    print(f"wrote: {OUT_JSONL}")
    print(f"wrote: {OUT_TXT}")
    print(f"wrote: {OUT_HTML}")


if __name__ == "__main__":
    main()
