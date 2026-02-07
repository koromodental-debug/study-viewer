# Codex Stability Guardrails

## Goal
Prevent Codex/Node OOM crashes by avoiding large in-memory payloads.

## Rules
- Never print large files in full.
- Prefer bounded reads:
  - `sed -n '1,120p' <file>`
  - `head -n 120 <file>`
  - `tail -n 120 <file>`
- For JSON/JSONL files larger than 1 MB:
  - Do not `cat` full content.
  - Use sampling only (`head`, `tail`, targeted `grep`).
- Keep command output compact:
  - Add `| head -n N` for broad searches.
  - Use targeted patterns instead of recursive full dumps.
- When reading logs:
  - Read latest section first (`tail`), then narrow with `grep`.
- If output starts getting too large, stop and switch to narrower queries.

## Large Files In This Repo
- `questions.json`
- `search-index.json`
- `fulltext-index.json`
- `graph-data.json`
- `question-topic-map.json`

## Safe Investigation Pattern
1. Identify candidate files with `find` and file sizes.
2. Read only top/bottom slices.
3. Use targeted `grep` for key terms.
4. Expand scope gradually only when needed.
