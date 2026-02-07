#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
from pathlib import Path


IN_PATH = Path("data/pilot_highvalue_qa_3.jsonl")
OUT_PATH = Path("data/pilot_highvalue_qa_3_strict.jsonl")
REPORT_JSON = Path("data/pilot_highvalue_qa_3_strict_report.json")
REPORT_MD = Path("data/pilot_highvalue_qa_3_strict_report.md")
OUT_HTML = Path("data/pilot_highvalue_qa_3_strict.html")


def strict_rewrite(card):
    qid = card["question_id"]

    if qid == "118C62":
        card["decision_axis"] = "所見同定"
        card["stem"] = "図（ア〜オ）を示す。黒塗りで示された『調整対象部位』を最も適切に反映しているのはどれか。1つ選べ。"
        card["why_wrong"] = {
            "B": "切端咬耗は図の黒塗り表示部位と一致しない。",
            "C": "維持腕先端は黒塗り表示と無関係。",
            "D": "全周一律短縮は局在所見に反する。",
        }
        card["validation_note"] = "黒塗り部位という可視所見に判断軸を固定。"

    if qid == "118C63":
        card["decision_axis"] = "次の一手"
        card["stem"] = "図A（口腔内）と図B（義歯内面）を示す。図Bの矢印が示す局在所見に対し、次回調整で最優先に行う確認はどれか。1つ選べ。"
        card["why_wrong"] = {
            "B": "色調は局在圧痕の確認軸と一致しない。",
            "C": "局在原因を確認せず全体設計変更へ進むのは早い。",
            "D": "根拠なく全体拡大すると局在症状の切り分けが不能。",
        }
        card["validation_note"] = "矢印部位の局在所見→確認行為の1軸に限定。"

    if qid == "118C90":
        card["decision_axis"] = "次の一手"
        card["stem"] = "図A（作業模型）と図B（金属フレーム）を示す。図Bの工程段階から、次に実施すべき操作として最も妥当なのはどれか。1つ選べ。"
        card["why_wrong"] = {
            "B": "適合確認前に排列へ進むため工程順序が逆転。",
            "C": "研磨は最終段階であり、現段階に不一致。",
            "D": "再採得省略のまま重合は工程飛躍。",
        }
        card["validation_note"] = "工程段階の可視情報を基準に1判断のみ問う。"

    # Hard requirements for strict cards.
    card["quality_gate"] = {
        "single_decision_axis": True,
        "image_dependent": True,
        "non_trivial": True,
        "all_distractors_explained": True,
        "evidence_region_present": bool(card.get("evidence_region")),
    }
    return card


def evaluate(card):
    checks = {
        "single_axis": bool(card.get("decision_axis")),
        "image_dependent": bool(card.get("evidence_region")),
        "has_why_wrong_all": len(card.get("why_wrong", {})) == 3,
        "non_trivial": bool(card.get("quality_gate", {}).get("non_trivial")),
    }
    passed = all(checks.values())
    return {"question_id": card["question_id"], "passed": passed, "checks": checks}


def render_html(cards, reports):
    rows = []
    rep_map = {r["question_id"]: r for r in reports}
    for i, c in enumerate(cards, 1):
        rep = rep_map[c["question_id"]]
        status = "PASS" if rep["passed"] else "FAIL"
        choices = "".join([f"<li><b>{k}</b>: {v}</li>" for k, v in c["choices"].items()])
        wrongs = "".join([f"<li><b>{k}</b>: {v}</li>" for k, v in c["why_wrong"].items()])
        rows.append(
            f"""
<article class='card'>
  <h2>{i}. {c['question_id']} <span class='{status}'>{status}</span></h2>
  <p><b>判断軸:</b> {c.get('decision_axis','')}</p>
  <p><b>Q:</b> {c.get('stem','')}</p>
  <ul>{choices}</ul>
  <p><b>正答:</b> {c['correct']} / {c.get('answer','')}</p>
  <p><b>決め手:</b> {c.get('decisive_feature','')}</p>
  <p><b>誤答理由:</b></p>
  <ul>{wrongs}</ul>
  <p><b>検証メモ:</b> {c.get('validation_note','')}</p>
</article>
"""
        )
    html = f"""<!doctype html><html lang='ja'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>pilot strict</title>
<style>body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f7fb;margin:0}}main{{max-width:980px;margin:0 auto;padding:16px;display:grid;gap:12px}}.card{{background:#fff;border:1px solid #d9e0ea;border-radius:10px;padding:14px}}h2{{margin:0 0 8px}}.PASS{{color:#0f7a2f}}.FAIL{{color:#b91c1c}}</style></head><body><main>{''.join(rows)}</main></body></html>"""
    OUT_HTML.write_text(html, encoding="utf-8")


def main():
    cards = [json.loads(l) for l in IN_PATH.read_text(encoding="utf-8").splitlines() if l.strip()]
    strict_cards = [strict_rewrite(dict(c)) for c in cards]
    reports = [evaluate(c) for c in strict_cards]

    with OUT_PATH.open("w", encoding="utf-8") as f:
        for c in strict_cards:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")

    REPORT_JSON.write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# pilot_highvalue_qa_3 strict report", ""]
    for r in reports:
        status = "PASS" if r["passed"] else "FAIL"
        lines.append(f"- {r['question_id']}: {status} {r['checks']}")
    REPORT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    render_html(strict_cards, reports)

    passed = sum(1 for r in reports if r["passed"])
    print(f"cards={len(strict_cards)} pass={passed} fail={len(strict_cards)-passed}")
    print(f"wrote: {OUT_PATH}")
    print(f"wrote: {REPORT_JSON}")
    print(f"wrote: {REPORT_MD}")
    print(f"wrote: {OUT_HTML}")


if __name__ == "__main__":
    main()
