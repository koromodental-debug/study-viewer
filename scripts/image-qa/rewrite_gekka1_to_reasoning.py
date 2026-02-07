#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
from pathlib import Path


IN_PATH = Path("data/gekka1_imagefirst_qa_20.jsonl")
OUT_JSONL = Path("data/gekka1_reasoning_qa_20.jsonl")
OUT_TXT = Path("data/gekka1_reasoning_qa_20.txt")
OUT_HTML = Path("data/gekka1_reasoning_qa_20.html")


def reasoning_stem(axis: str, hint: str):
    if axis == "診断":
        return f"図Aを見て、まず何を根拠に診断仮説を立てるべきか。最も妥当な判断はどれか。1つ選べ。"
    if axis == "次の一手":
        return f"図Aの主所見（{hint}）から、次に進むべき判断として最も妥当なのはどれか。1つ選べ。"
    if axis == "処置目的":
        return "図Aを見て、この操作の目的をどう考えるのが最も妥当か。1つ選べ。"
    return "図Aを見て、最初に固定すべき観察解釈として最も妥当なのはどれか。1つ選べ。"


def thinking_line(axis: str, hint: str):
    if axis == "診断":
        return f"考える順: 画像所見を抽出（{hint}）→ 疾患パターンに照合 → 最有力仮説を1つに絞る"
    if axis == "次の一手":
        return f"考える順: 所見（{hint}）→ 可逆/不可逆を判定 → 先に行う対応を1つ選ぶ"
    return f"考える順: 所見（{hint}）→ 判断軸を固定 → それに一致する選択肢を選ぶ"


def main():
    rows = []
    with IN_PATH.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))

    out = []
    for r in rows:
        hint = r.get("evidence_hint", "画像所見")
        axis = r.get("decision_axis", "診断")
        nr = dict(r)
        nr["source_mode"] = "reasoning_first"
        nr["stem"] = reasoning_stem(axis, hint)
        nr["thinking_guide"] = thinking_line(axis, hint)
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
            f.write(f"{r['thinking_guide']}\n")
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
            f"<p><b>Q:</b> {r['stem']}</p>"
            f"<p><b>思考ガイド:</b> {r['thinking_guide']}</p>"
            f"<ul>{lis}</ul><p><b>正答:</b> {c} {ans}</p></article>"
        )
    html = (
        "<!doctype html><html lang='ja'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'><title>外科1 reasoning 20</title>"
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
