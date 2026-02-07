# Image QA Pipeline

## Files
- `schema.json`
- `generate_image_annotations.js`
- `normalize_tags.js`
- `generate_image_qa_from_approved.js`

## Flow
0. Import OCR annotations as draft candidates:
```bash
python3 scripts/image-qa/import_ocr_annotations.py \
  --glob "../解説PDF/画像診断_抽出/*/annotations.csv" \
  --questions questions.json \
  --out data/ocr_annotation_candidates.jsonl
```

1. Build draft annotations:
```bash
node scripts/image-qa/generate_image_annotations.js \
  --index data/image_question_index.jsonl \
  --questions questions.json \
  --out data/draft_image_annotations.jsonl
```

2. Normalize tags:
```bash
node scripts/image-qa/normalize_tags.js \
  --input data/draft_image_annotations.jsonl \
  --output data/draft_image_annotations.jsonl
```

3. Human review:
- Copy approved rows into `data/approved_image_annotations.jsonl`
- Use `status: "approved"` for rows to publish.

4. Generate QA from approved only:
```bash
node scripts/image-qa/generate_image_qa_from_approved.js \
  --approved data/approved_image_annotations.jsonl \
  --questions questions.json \
  --out data/generated_image_qa.json
```

## Policy
- QA generation uses only `approved` annotations.
- `draft` and `rejected` rows are ignored.
