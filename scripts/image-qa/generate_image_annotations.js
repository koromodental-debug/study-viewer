#!/usr/bin/env node
/*
 * Build draft_image_annotations.jsonl from image_question_index.jsonl.
 * This creates machine-generated drafts only. Final labeling must be human-reviewed.
 */

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function inferModality(imageRelpath, imageId) {
  const text = `${imageRelpath} ${imageId}`.toLowerCase();
  const out = [];
  if (/(ct|cbct|computed)/.test(text)) out.push("CT");
  if (/(mri|mr)/.test(text)) out.push("MRI");
  if (/(pa|pano|panorama|xray|xp|x-p|レントゲン|エックス線)/.test(text)) out.push("X線");
  if (/(echo|ultra|us)/.test(text)) out.push("超音波");
  if (/(photo|oral|顔貌|口腔内)/.test(text)) out.push("写真");
  return out.length ? out : ["不明"];
}

function inferTags(questionText, choices) {
  const text = `${questionText || ""} ${Object.values(choices || {}).join(" ")}`;
  const rules = [
    { regex: /(骨折|fracture)/i, finding: "骨折線", anatomy: "顎骨" },
    { regex: /(嚢胞|cyst)/i, finding: "嚢胞性透過像", anatomy: "顎骨" },
    { regex: /(腫瘍|tumor|癌)/i, finding: "腫瘤影", anatomy: "口腔領域" },
    { regex: /(上顎洞|maxillary sinus)/i, finding: "上顎洞陰影変化", anatomy: "上顎洞" },
    { regex: /(顎関節|tmj)/i, finding: "関節形態異常", anatomy: "顎関節" },
    { regex: /(歯周|歯槽骨|bone loss)/i, finding: "骨吸収像", anatomy: "歯槽骨" },
    { regex: /(根尖|periapical)/i, finding: "根尖病変", anatomy: "歯根尖部" },
    { regex: /(埋伏|impaction)/i, finding: "埋伏歯", anatomy: "歯" },
    { regex: /(石灰化|calcification)/i, finding: "石灰化像", anatomy: "軟組織" },
    { regex: /(拡大|透過像|不透過像)/i, finding: "濃度変化", anatomy: "顎骨" }
  ];

  const findingTags = [];
  const anatomyTags = [];
  for (const rule of rules) {
    if (rule.regex.test(text)) {
      findingTags.push(rule.finding);
      anatomyTags.push(rule.anatomy);
    }
  }

  return {
    findingTags: uniq(findingTags.length ? findingTags : ["未確定所見"]),
    anatomyTags: uniq(anatomyTags.length ? anatomyTags : ["未確定部位"])
  };
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = path.resolve(__dirname, "../..");
  const indexPath = path.resolve(repoRoot, args.index || "data/image_question_index.jsonl");
  const questionsPath = path.resolve(repoRoot, args.questions || "questions.json");
  const outPath = path.resolve(repoRoot, args.out || "data/draft_image_annotations.jsonl");
  const limit = args.limit ? Number(args.limit) : null;

  if (!fs.existsSync(indexPath)) {
    throw new Error(`index not found: ${indexPath}`);
  }
  if (!fs.existsSync(questionsPath)) {
    throw new Error(`questions not found: ${questionsPath}`);
  }

  const questions = readJson(questionsPath).questions || [];
  const qMap = new Map(questions.map((q) => [q.id, q]));
  const indexRows = readJsonl(indexPath);

  const generated = [];
  for (const row of indexRows) {
    if (!row.question_id || row.question_exists === false) continue;
    const q = qMap.get(row.question_id);
    if (!q) continue;

    const inferred = inferTags(q.questionText, q.choices);
    const modalityTags = inferModality(row.image_relpath || "", row.image_id || "");
    const summary = `${row.question_id} の画像について一次判定（自動）を作成`;

    generated.push({
      annotation_id: `${row.question_id}:${row.image_id}`,
      question_id: row.question_id,
      image_id: row.image_id,
      image_relpath: row.image_relpath || "",
      year: row.year ?? q.year ?? null,
      status: "draft",
      finding_tags: inferred.findingTags,
      anatomy_tags: inferred.anatomyTags,
      modality_tags: modalityTags,
      summary_ja: summary,
      evidence_text: q.questionText || "",
      confidence: 0.45,
      reviewer: null,
      review_comment: null,
      source: "auto:generate_image_annotations.js",
      updated_at: new Date().toISOString()
    });

    if (limit && generated.length >= limit) break;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const body = generated.map((x) => JSON.stringify(x, null, 0)).join("\n");
  fs.writeFileSync(outPath, body + (body ? "\n" : ""), "utf8");

  console.log(`generated=${generated.length}`);
  console.log(`wrote=${outPath}`);
}

main();
