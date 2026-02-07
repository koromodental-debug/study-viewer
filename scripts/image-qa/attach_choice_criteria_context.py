#!/usr/bin/env python3
import argparse
import json
import re
from collections import Counter
from pathlib import Path

STOP = {
    "する", "ある", "なる", "いる", "こと", "ため", "より", "これ", "それ",
    "どれ", "写真", "図", "問題", "選択肢", "最も", "1つ", "示す", "確認", "部位",
    "義歯", "調整", "画像",
}


def tokenize(text: str):
    text = re.sub(r"[^0-9A-Za-zぁ-んァ-ヶ一-龠ー]", " ", text)
    toks = [t for t in text.split() if len(t) >= 2 and t not in STOP]
    return toks


def score(query_tokens, candidate_text):
    cand = tokenize(candidate_text)
    if not cand:
        return 0.0
    c = Counter(cand)
    q = Counter(query_tokens)
    s = 0.0
    for t, n in q.items():
        if t in c:
            s += min(n, c[t])
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in-cards", required=True)
    ap.add_argument("--library", default="data/choice_criteria_library.jsonl")
    ap.add_argument("--topic", default="補綴２")
    ap.add_argument("--out", required=True)
    ap.add_argument("--topk", type=int, default=3)
    args = ap.parse_args()

    cards = []
    with open(args.in_cards, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                cards.append(json.loads(line))

    lib = []
    with open(args.library, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            if o.get("topic") == args.topic:
                lib.append(o)

    out_rows = []
    for card in cards:
        query = " ".join([
            card.get("stem", ""),
            card.get("judgment_target", ""),
            card.get("decisive_feature", ""),
            " ".join(card.get("choices", {}).values()),
        ])
        qt = tokenize(query)
        scored = []
        for row in lib:
            basis = " ".join(row.get("wrong_evidence", [])[:3] + row.get("correct_evidence", [])[:2])
            sc = score(qt, basis)
            if sc > 0:
                scored.append((sc, row, basis))
        scored.sort(key=lambda x: x[0], reverse=True)
        picked = []
        for sc, row, basis in scored[: args.topk]:
            picked.append({
                "problem_code": row.get("problem_code"),
                "topic": row.get("topic"),
                "score": sc,
                "basis_snippet": basis[:220],
                "source_file": row.get("source_file"),
            })

        card2 = dict(card)
        card2["choice_criteria_context"] = picked
        card2["choice_criteria_context_note"] = (
            "直接同一コードが無い場合、選択肢考察OCRの近傍根拠（語彙一致）を使用"
        )
        out_rows.append(card2)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for r in out_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"cards={len(out_rows)}")
    print(f"wrote: {out_path}")


if __name__ == "__main__":
    main()
