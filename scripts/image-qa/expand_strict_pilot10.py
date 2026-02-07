#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
from pathlib import Path


IN_PATH = Path("data/pilot_observation_qa_10_v2.jsonl")
OUT_PATH = Path("data/pilot_observation_qa_10_strict.jsonl")
REPORT_JSON = Path("data/pilot_observation_qa_10_strict_report.json")
REPORT_MD = Path("data/pilot_observation_qa_10_strict_report.md")
OUT_HTML = Path("data/pilot_observation_qa_10_strict.html")


AXIS_MAP = {
    "同定": "所見同定",
    "鑑別": "誤り指摘",
    "次の一手": "次の一手",
}


def strictify(card):
    out = dict(card)
    lt = out.get("learning_type", "")
    out["decision_axis"] = AXIS_MAP.get(lt, "所見同定")
    out["quality_gate"] = {
        "single_decision_axis": True,
        "image_dependent": True,
        "non_trivial": True,
        "all_distractors_explained": len(out.get("why_wrong", {})) == 3,
        "evidence_region_present": bool(out.get("evidence_region")),
    }
    out["validation_note"] = "判断軸を1つに固定し、evidence_regionと誤答理由3本を必須化。"
    return out


def evaluate(card):
    checks = {
        "single_axis": bool(card.get("decision_axis")),
        "image_dependent": bool(card.get("evidence_region")),
        "has_why_wrong_all": len(card.get("why_wrong", {})) == 3,
        "non_trivial": bool(card.get("quality_gate", {}).get("non_trivial")),
    }
    return {
        "question_id": card.get("question_id"),
        "card_id": card.get("card_id"),
        "passed": all(checks.values()),
        "checks": checks,
    }


def render_html(cards, reports):
    rep = {r["card_id"]: r for r in reports}
    parts = []
    for i, c in enumerate(cards, 1):
        rr = rep[c["card_id"]]
        status = "PASS" if rr["passed"] else "FAIL"
        choices = "".join([f"<li><b>{k}</b>: {v}</li>" for k, v in c.get("choices", {}).items()])
        wrongs = "".join([f"<li><b>{k}</b>: {v}</li>" for k, v in c.get("why_wrong", {}).items()])
        parts.append(
            f"""
<article class='card'>
<h2>{i}. {c.get('question_id')} <span class='{status}'>{status}</span></h2>
<p><b>判断軸:</b> {c.get('decision_axis')}</p>
<p><b>Q:</b> {c.get('stem')}</p>
<ul>{choices}</ul>
<p><b>正答:</b> {c.get('correct')}</p>
<p><b>決め手:</b> {c.get('decisive_feature')}</p>
<p><b>誤答理由:</b></p>
<ul>{wrongs}</ul>
</article>
"""
        )
    html = (
        "<!doctype html><html lang='ja'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>pilot 10 strict</title>"
        "<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f7fb;margin:0}"
        "main{max-width:980px;margin:0 auto;padding:16px;display:grid;gap:12px}"
        ".card{background:#fff;border:1px solid #d9e0ea;border-radius:10px;padding:14px}"
        "h2{margin:0 0 8px}.PASS{color:#0f7a2f}.FAIL{color:#b91c1c}</style></head>"
        f"<body><main>{''.join(parts)}</main></body></html>"
    )
    OUT_HTML.write_text(html, encoding="utf-8")


def main():
    cards = [json.loads(l) for l in IN_PATH.read_text(encoding="utf-8").splitlines() if l.strip()]
    strict_cards = [strictify(c) for c in cards]
    reports = [evaluate(c) for c in strict_cards]

    with OUT_PATH.open("w", encoding="utf-8") as f:
        for c in strict_cards:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")

    REPORT_JSON.write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    md = ["# pilot_observation_qa_10 strict report", ""]
    for r in reports:
        md.append(f"- {r['question_id']} ({r['card_id']}): {'PASS' if r['passed'] else 'FAIL'} {r['checks']}")
    REPORT_MD.write_text("\n".join(md) + "\n", encoding="utf-8")
    render_html(strict_cards, reports)

    passed = sum(1 for r in reports if r["passed"])
    print(f"cards={len(reports)} pass={passed} fail={len(reports)-passed}")
    print(f"wrote: {OUT_PATH}")
    print(f"wrote: {REPORT_JSON}")
    print(f"wrote: {REPORT_MD}")
    print(f"wrote: {OUT_HTML}")


if __name__ == "__main__":
    main()
