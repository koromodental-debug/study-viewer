#!/usr/bin/env python3
import csv
import json
import re
from pathlib import Path

SRC_ROOT = Path("/Users/saitouryuuichi/Desktop/国試データベース/解説PDF/選択肢考察_抽出")
OUT_JSONL = Path("/Users/saitouryuuichi/Desktop/国試データベース/study-viewer/data/choice_criteria_library.jsonl")
OUT_SUMMARY = Path("/Users/saitouryuuichi/Desktop/国試データベース/study-viewer/data/choice_criteria_patterns_summary.json")

MARK_CORRECT = ("○", "〇", "●")
MARK_WRONG = ("×", "✕", "✖")


def clean_text(s: str) -> str:
    s = s.replace("\ufeff", "").replace("\r", " ").replace("\n", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def split_sentences(s: str):
    parts = re.split(r"[。．]\s*", s)
    return [p.strip() for p in parts if p.strip()]


def extract_marked_sentences(raw: str):
    text = clean_text(raw)
    sentences = split_sentences(text)
    correct = []
    wrong = []
    for sent in sentences:
        if any(m in sent for m in MARK_CORRECT):
            correct.append(sent)
        if any(m in sent for m in MARK_WRONG):
            wrong.append(sent)
    # keep concise snippets for downstream prompts
    return correct[:4], wrong[:6]


def infer_topic(path: Path) -> str:
    rel = path.relative_to(SRC_ROOT)
    return rel.parts[0] if len(rel.parts) > 1 else "unknown"


def iter_contents_rows():
    for p in SRC_ROOT.rglob("sentakushi_contents.csv"):
        topic = infer_topic(p)
        with p.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                code = clean_text(row.get("問題コード", ""))
                raw = row.get("選択肢考察_raw", "") or ""
                if not code or not raw:
                    continue
                correct, wrong = extract_marked_sentences(raw)
                if not correct and not wrong:
                    continue
                yield {
                    "problem_code": code,
                    "topic": topic,
                    "source_file": str(p),
                    "correct_evidence": correct,
                    "wrong_evidence": wrong,
                    "raw_excerpt": clean_text(raw)[:500],
                }


def build():
    rows = list(iter_contents_rows())
    OUT_JSONL.parent.mkdir(parents=True, exist_ok=True)
    with OUT_JSONL.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    # Aggregate common wrong patterns for prompt-time constraints.
    counter = {}
    for r in rows:
        for w in r["wrong_evidence"]:
            key = re.sub(r"^[×✕✖]\s*", "", w)
            key = re.sub(r"[a-eA-E][\s,、.]*", "", key)
            key = key.strip()
            if len(key) < 10:
                continue
            counter[key] = counter.get(key, 0) + 1
    top_patterns = sorted(counter.items(), key=lambda x: x[1], reverse=True)[:120]
    summary = {
        "total_records": len(rows),
        "top_wrong_patterns": [{"pattern": k, "count": v} for k, v in top_patterns],
    }
    OUT_SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"records={len(rows)}")
    print(f"wrote: {OUT_JSONL}")
    print(f"wrote: {OUT_SUMMARY}")


if __name__ == "__main__":
    build()
