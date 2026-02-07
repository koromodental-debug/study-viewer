#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fetch 118th dental exam pages from dentalyouth.blog and export JSON.
"""

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup


EXAM_URLS = {
    "118A": "https://dentalyouth.blog/archives/26526",
    "118B": "https://dentalyouth.blog/archives/26527",
    "118C": "https://dentalyouth.blog/archives/26528",
    "118D": "https://dentalyouth.blog/archives/26529",
}


def normalize_answer_token(s: str) -> str:
    t = (s or "").strip()
    # Full-width to half-width.
    t = t.translate(str.maketrans("ａｂｃｄｅＡＢＣＤＥ", "abcdeABCDE"))
    # Keep only answer letters.
    t = "".join(ch for ch in t.upper() if ch in "ABCDE")
    return t


def extract_answers(html: str, wrap_text: str) -> list[str]:
    answers = []

    # Pattern 1: innerHTML = "解答：A"
    p1 = re.findall(r'innerHTML\s*=\s*["\']\s*解答[：:]\s*([A-Ea-eａ-ｅＡ-Ｅ]{1,5})\s*["\']', html)
    answers.extend(p1)

    # Pattern 2: visible text "解答：A" in HTML/text.
    p2_html = re.findall(r'解答[：:]\s*([A-Ea-eａ-ｅＡ-Ｅ]{1,5})', html)
    p2_text = re.findall(r'解答[：:]\s*([A-Ea-eａ-ｅＡ-Ｅ]{1,5})', wrap_text)
    answers.extend(p2_html)
    answers.extend(p2_text)

    norm = [normalize_answer_token(a) for a in answers]
    norm = [a for a in norm if a]

    # Keep order while deduplicating consecutive noise duplicates.
    out = []
    for a in norm:
        if out and out[-1] == a:
            continue
        out.append(a)
    return out


def fetch_page(url: str) -> str:
    headers = {"User-Agent": "Mozilla/5.0"}
    res = requests.get(url, headers=headers, timeout=60)
    res.encoding = "utf-8"
    res.raise_for_status()
    return res.text


def parse_single_problem(text: str) -> dict:
    result = {
        "question_text": "",
        "choices": {},
        "choice_count": 1,
        "has_figure": False,
        "figure_refs": [],
    }

    lines = text.split("\n")
    question_lines = []
    choices = {}

    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith("あ"):
            line = line[1:]

        m = re.match(r"^([a-eａ-ｅ])[　\s]+(.+)$", line)
        if m:
            label = m.group(1).lower().translate(str.maketrans("ａｂｃｄｅ", "abcde"))
            choices[label] = m.group(2)
            continue
        question_lines.append(line)

    qt = "\n".join(question_lines)
    result["question_text"] = qt
    result["choices"] = choices

    if "2つ選べ" in qt:
        result["choice_count"] = 2
    elif "3つ選べ" in qt:
        result["choice_count"] = 3

    if "別冊No" in qt or "図に示す" in qt or "図を示す" in qt:
        result["has_figure"] = True
        result["figure_refs"] = re.findall(r"別冊No[\.．]?\s*(\d+[A-Z]?)", qt)

    return result


def parse_problems(html: str, exam_code: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    problems = []

    content = soup.find("section", class_="entry-content")
    if not content:
        return problems

    wrap = content.find("div", class_="theContentWrap-ccc") or content
    wrap_text = wrap.get_text()
    answers = extract_answers(html, wrap_text)

    images = {}
    for img in wrap.find_all("img"):
        src = img.get("src", "")
        m = re.search(r"(\d{3}[A-D]\d+)", src)
        if m:
            key = m.group(1)
            images.setdefault(key, []).append(src)

    lines = wrap_text.split("\n")
    current = None
    problem_text = []
    answer_idx = 0

    for line in lines:
        line = line.strip()
        if not line:
            continue

        pm = re.match(rf"^({exam_code}(\d+))$", line)
        if pm:
            if current:
                parsed = parse_single_problem("\n".join(problem_text))
                current.update(parsed)
                if answer_idx < len(answers):
                    current["answer"] = answers[answer_idx]
                    answer_idx += 1
                img_key = f"{exam_code}{current['number']}"
                current["images"] = images.get(img_key, [])
                problems.append(current)

            current = {
                "exam_code": exam_code,
                "number": int(pm.group(2)),
                "full_code": pm.group(1),
            }
            problem_text = []
            continue

        if current:
            if line.startswith("解答：") or line in {"表示", "目次"}:
                continue
            problem_text.append(line)

    if current:
        parsed = parse_single_problem("\n".join(problem_text))
        current.update(parsed)
        if answer_idx < len(answers):
            current["answer"] = answers[answer_idx]
        img_key = f"{exam_code}{current['number']}"
        current["images"] = images.get(img_key, [])
        problems.append(current)

    return problems


def main() -> int:
    out_dir = Path("data/web_scrape")
    out_dir.mkdir(parents=True, exist_ok=True)

    total = 0
    for exam_code, url in EXAM_URLS.items():
        print(f"fetch {exam_code}: {url}")
        html = fetch_page(url)
        problems = parse_problems(html, exam_code)
        total += len(problems)
        out_path = out_dir / f"{exam_code}_Web取得_refetch.json"
        out_path.write_text(json.dumps(problems, ensure_ascii=False, indent=2), encoding="utf-8")
        with_fig = sum(1 for p in problems if p.get("has_figure"))
        with_answer = sum(1 for p in problems if p.get("answer"))
        print(
            f"  problems={len(problems)} figure={with_fig} answer={with_answer} wrote={out_path}"
        )
        time.sleep(1)

    print(f"done total={total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
