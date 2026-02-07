#!/usr/bin/env node
/*
 * Generate image QA JSON from approved_image_annotations.jsonl only.
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

function hashCode(input) {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pickDistractors(correct, pool, count, seedKey) {
  const candidates = pool.filter((x) => x && x !== correct);
  if (candidates.length <= count) return candidates;
  const picked = [];
  const used = new Set();
  let cursor = hashCode(seedKey) % candidates.length;
  while (picked.length < count && used.size < candidates.length) {
    if (!used.has(cursor)) {
      picked.push(candidates[cursor]);
      used.add(cursor);
    }
    cursor = (cursor + 7) % candidates.length;
  }
  return picked;
}

function shuffleDeterministic(values, seedKey) {
  const out = values.slice();
  let seed = hashCode(seedKey) || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function toChoiceKey(index) {
  return ["A", "B", "C", "D", "E"][index] || "A";
}

function buildStem(modality, anatomy) {
  const figureWord = modality === "写真" ? "写真" : "図";
  const area = anatomy && anatomy !== "未確定部位" ? `（${anatomy}）` : "";
  return `${figureWord}${area}を示す。画像所見として最も適切なのはどれか。1つ選べ。`;
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = path.resolve(__dirname, "../..");
  const approvedPath = path.resolve(
    repoRoot,
    args.approved || "data/approved_image_annotations.jsonl"
  );
  const questionsPath = path.resolve(repoRoot, args.questions || "questions.json");
  const outputPath = path.resolve(repoRoot, args.out || "data/generated_image_qa.json");
  const minConfidence = args.minConfidence ? Number(args.minConfidence) : 0;

  if (!fs.existsSync(approvedPath)) {
    throw new Error(`approved file not found: ${approvedPath}`);
  }
  if (!fs.existsSync(questionsPath)) {
    throw new Error(`questions file not found: ${questionsPath}`);
  }

  const approvedRows = readJsonl(approvedPath).filter(
    (r) => r.status === "approved" && Number(r.confidence || 0) >= minConfidence
  );
  const qMap = new Map((readJson(questionsPath).questions || []).map((q) => [q.id, q]));
  const findingPool = [...new Set(approvedRows.flatMap((r) => r.finding_tags || []))].filter(Boolean);

  const qa = [];
  for (const row of approvedRows) {
    const q = qMap.get(row.question_id);
    if (!q) continue;
    const correct = (row.finding_tags || [])[0];
    if (!correct) continue;

    const distractors = pickDistractors(correct, findingPool, 4, row.annotation_id);
    const optionValues = shuffleDeterministic([correct, ...distractors], row.annotation_id).slice(0, 5);
    const choices = {};
    let correctAnswer = "A";
    optionValues.forEach((value, i) => {
      const key = toChoiceKey(i);
      choices[key.toLowerCase()] = value;
      if (value === correct) correctAnswer = key;
    });

    const modality = (row.modality_tags || [])[0] || "図";
    const anatomy = (row.anatomy_tags || [])[0] || "";
    const stem = buildStem(modality, anatomy);
    const explanation = row.summary_ja || row.evidence_text || q.questionText || "";

    qa.push({
      question: stem,
      answer: `正解: ${correctAnswer}`,
      choices,
      correctAnswer,
      numChoices: 1,
      code: row.question_id,
      imagePath: row.image_relpath || "",
      explanation,
      sourceAnnotationId: row.annotation_id
    });
  }

  const payload = {
    metadata: {
      title: "画像診断（approved由来）",
      category: "画像診断",
      chapter: "画像所見",
      generatedAt: new Date().toISOString(),
      policy: "approved_only",
      totalCards: qa.length
    },
    sections: [
      {
        section: "画像所見問題",
        qa
      }
    ]
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`approved_rows=${approvedRows.length}`);
  console.log(`cards=${qa.length}`);
  console.log(`wrote=${outputPath}`);
}

main();
