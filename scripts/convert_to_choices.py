#!/usr/bin/env python3
"""
[他の選択肢との違い] 付きQAを選択肢カード形式に変換するスクリプト

変換前:
  {"question": "[110A62] ★★★\n口腔隔膜を形成する筋は？",
   "answer": "顎舌骨筋\n\n[他の選択肢との違い]\n- a 咬筋: × ...\n- b 顎舌骨筋: ○ ...\n\n[ポイント]\n..."}

変換後:
  {"question": "[110A62] ★★★\n口腔隔膜を形成する筋は？",
   "answer": "B", "choices": {"a": "咬筋", "b": "顎舌骨筋", ...},
   "correctAnswer": "B", "numChoices": 1, "code": "110A62",
   "choiceExplanations": {"a": "...", "b": "..."}, "point": "..."}
"""

import json
import re
from pathlib import Path

QA_DIR = Path(__file__).parent.parent / "qa" / "subject"


def parse_choice_line(line):
    """選択肢行をパース"""
    line = line.strip()
    if not line.startswith("- "):
        return None
    content = line[2:]

    # a-e ラベルの検出
    key = None
    m = re.match(r"^([a-e])\s+", content)
    if m:
        key = m.group(1)
        content = content[m.end():]

    # 正解判定
    is_correct = "○" in content or "正解" in content

    # 選択肢テキストと解説を分離（最初の : or ： で分割）
    colon_match = re.search(r"[:：]", content)
    if colon_match:
        choice_text = content[:colon_match.start()].strip()
        explanation = content[colon_match.end():].strip()
    else:
        choice_text = content.strip()
        explanation = ""

    # 解説の先頭 ○/× マークを除去
    explanation = re.sub(r"^[○×]\s*", "", explanation).strip()

    return {
        "key": key,
        "text": choice_text,
        "explanation": explanation,
        "correct": is_correct,
    }


def convert_entry(qa):
    """1つのQAエントリを選択肢形式に変換。変換不可ならNoneを返す"""
    answer_text = qa.get("answer", "")
    question_text = qa.get("question", "")

    if "[他の選択肢との違い]" not in answer_text:
        return None

    # 正解テキスト（1行目）
    first_line = answer_text.split("\n")[0].strip()

    # セクション分割
    sentakushi_idx = answer_text.find("[他の選択肢との違い]")
    point_idx = answer_text.find("[ポイント]")

    if point_idx != -1 and point_idx > sentakushi_idx:
        choices_text = answer_text[sentakushi_idx + len("[他の選択肢との違い]"):point_idx]
        point_text = answer_text[point_idx + len("[ポイント]"):].strip()
    else:
        choices_text = answer_text[sentakushi_idx + len("[他の選択肢との違い]"):]
        point_text = ""

    # 選択肢行をパース
    parsed = []
    for line in choices_text.split("\n"):
        result = parse_choice_line(line)
        if result:
            parsed.append(result)

    if len(parsed) < 2:
        return None

    # キーがない場合は a, b, c, ... を割り当て
    has_keys = all(c["key"] is not None for c in parsed)
    if not has_keys:
        for i, c in enumerate(parsed):
            c["key"] = chr(ord("a") + i)

    # choices辞書を構築
    choices = {c["key"]: c["text"] for c in parsed}

    # 正解キーの特定
    correct_keys = [c["key"] for c in parsed if c["correct"]]

    if not correct_keys:
        # ○/正解マークがない場合、1行目の正解テキストで照合
        for c in parsed:
            if c["text"] == first_line or c["text"] in first_line or first_line in c["text"]:
                correct_keys = [c["key"]]
                break

    if not correct_keys:
        # 正解が選択肢リストに含まれないパターン
        # → first_lineを正解選択肢として先頭に挿入
        # 既存選択肢のキーをb以降にずらす
        new_parsed = []
        for i, c in enumerate(parsed):
            c["key"] = chr(ord("b") + i)
            new_parsed.append(c)
        # first_lineを正解としてaに挿入
        new_parsed.insert(0, {
            "key": "a",
            "text": first_line,
            "explanation": "正解",
            "correct": True,
        })
        parsed = new_parsed
        correct_keys = ["a"]
        # choices辞書を再構築
        choices = {c["key"]: c["text"] for c in parsed}

    correct_answer = ", ".join(k.upper() for k in sorted(correct_keys))

    # 問題コード抽出
    code_match = re.search(r"\[(\d+[A-Z]\d+)\]", question_text)
    code = code_match.group(1) if code_match else ""

    # 結果を構築
    result = {
        "question": question_text,
        "answer": correct_answer,
        "choices": choices,
        "correctAnswer": correct_answer,
        "numChoices": len(correct_keys),
    }

    if code:
        result["code"] = code

    # 選択肢ごとの解説
    choice_explanations = {}
    for c in parsed:
        if c["explanation"]:
            choice_explanations[c["key"]] = c["explanation"]
    if choice_explanations:
        result["choiceExplanations"] = choice_explanations

    if point_text:
        result["point"] = point_text

    return result


def main():
    total = 0
    converted = 0
    skipped = 0
    files_modified = 0

    for jf in sorted(QA_DIR.rglob("*.json")):
        with open(jf, "r", encoding="utf-8") as f:
            data = json.load(f)

        modified = False
        for sec in data.get("sections", []):
            new_qa = []
            for qa in sec.get("qa", []):
                if "[他の選択肢との違い]" in qa.get("answer", ""):
                    total += 1
                    result = convert_entry(qa)
                    if result:
                        new_qa.append(result)
                        converted += 1
                        modified = True
                    else:
                        new_qa.append(qa)
                        skipped += 1
                else:
                    new_qa.append(qa)
            sec["qa"] = new_qa

        if modified:
            with open(jf, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")
            files_modified += 1

    print(f"対象: {total}")
    print(f"変換: {converted}")
    print(f"スキップ: {skipped}")
    print(f"変更ファイル: {files_modified}")


if __name__ == "__main__":
    main()
