#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fetch explanation-candidate articles from dentalyouth.blog using keyword search.
Outputs compact JSONL for manual curation.
"""

import argparse
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup


UA = {"User-Agent": "Mozilla/5.0"}
SEARCH_BASE = "https://dentalyouth.blog/?s="


@dataclass
class Task:
    question_id: str
    keywords: List[str]


DEFAULT_TASKS = [
    Task("118C62", ["カ行", "発音", "義歯", "口蓋"]),
    Task("118C63", ["義歯", "調整", "圧痕", "疼痛"]),
    Task("118C90", ["フレームワーク", "試適", "部分床義歯", "工程"]),
]


def fetch(url: str) -> str:
    r = requests.get(url, headers=UA, timeout=40)
    r.encoding = "utf-8"
    r.raise_for_status()
    return r.text


def clean(s: str) -> str:
    s = s.replace("\u3000", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_search_results(html: str):
    soup = BeautifulSoup(html, "html.parser")
    seen = set()
    out = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        title = clean(a.get_text(" ", strip=True))
        if "/archives/" not in href or not title:
            continue
        if href in seen:
            continue
        seen.add(href)
        out.append((title, href))
    return out


def is_low_value_title(title: str) -> bool:
    ng = [
        "第119回",
        "第118回 歯科医師国家試験",
        "第117回 歯科医師国家試験",
        "ポイント Point Note",
        "勉強法&コラム",
    ]
    return any(x in title for x in ng)


def extract_excerpt(html: str, keywords: List[str]) -> str:
    soup = BeautifulSoup(html, "html.parser")
    sec = soup.find("section", class_="entry-content")
    text = clean(sec.get_text(" ", strip=True) if sec else soup.get_text(" ", strip=True))
    if not text:
        return ""
    for kw in keywords:
        i = text.find(kw)
        if i >= 0:
            s = max(0, i - 70)
            e = min(len(text), i + 170)
            return text[s:e]
    return text[:240]


def score(title: str, excerpt: str, keywords: List[str]) -> int:
    t = title + " " + excerpt
    return sum(1 for kw in keywords if kw in t)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/web_scrape/explanation_candidates_3q.jsonl")
    ap.add_argument("--max-results", type=int, default=20)
    ap.add_argument("--max-fetch", type=int, default=8)
    args = ap.parse_args()

    out_rows = []
    for task in DEFAULT_TASKS:
        query = " ".join(task.keywords)
        url = SEARCH_BASE + quote(query)
        print(f"search {task.question_id}: {query}")
        html = fetch(url)
        links = parse_search_results(html)[: args.max_results]

        # Prioritize non-index pages.
        ranked = sorted(links, key=lambda x: (is_low_value_title(x[0]), len(x[0])))
        fetched = 0
        for title, href in ranked:
            if fetched >= args.max_fetch:
                break
            try:
                page = fetch(href)
            except Exception:
                continue
            excerpt = extract_excerpt(page, task.keywords)
            sc = score(title, excerpt, task.keywords)
            if sc <= 0:
                continue
            out_rows.append(
                {
                    "question_id": task.question_id,
                    "query": query,
                    "title": title,
                    "url": href,
                    "score": sc,
                    "excerpt": excerpt,
                }
            )
            fetched += 1
            time.sleep(0.5)

    # Keep top candidates per question.
    grouped = {}
    for r in out_rows:
        grouped.setdefault(r["question_id"], []).append(r)

    final_rows = []
    for qid, rows in grouped.items():
        rows.sort(key=lambda x: x["score"], reverse=True)
        final_rows.extend(rows[:8])

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for r in final_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"candidates={len(final_rows)} wrote={out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
