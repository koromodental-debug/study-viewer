#!/usr/bin/env node
/*
 * Normalize tags in draft/approved annotation JSONL.
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

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJsonl(filePath, rows) {
  const body = rows.map((r) => JSON.stringify(r)).join("\n");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body + (body ? "\n" : ""), "utf8");
}

function normalizeToken(value, map) {
  const s = String(value || "").trim();
  if (!s) return "";
  return map[s] || map[s.toLowerCase()] || s;
}

function uniqSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = path.resolve(__dirname, "../..");
  const inputPath = path.resolve(repoRoot, args.input || "data/draft_image_annotations.jsonl");
  const outputPath = path.resolve(repoRoot, args.output || inputPath);

  const synonymMap = {
    "x-p": "X線",
    xp: "X線",
    xray: "X線",
    "x線": "X線",
    "x線写真": "X線",
    mri: "MRI",
    ct: "CT",
    cbct: "CBCT",
    "超音波検査": "超音波",
    us: "超音波",
    "顎関節症": "顎関節形態異常",
    "骨吸収": "骨吸収像",
    "骨折": "骨折線",
    "根尖病巣": "根尖病変",
    "のう胞": "嚢胞性透過像",
    "嚢胞": "嚢胞性透過像"
  };

  const rows = readJsonl(inputPath);
  const normalized = rows.map((row) => {
    const findingTags = uniqSorted(
      (row.finding_tags || []).map((x) => normalizeToken(x, synonymMap))
    );
    const anatomyTags = uniqSorted(
      (row.anatomy_tags || []).map((x) => normalizeToken(x, synonymMap))
    );
    const modalityTags = uniqSorted(
      (row.modality_tags || []).map((x) => normalizeToken(x, synonymMap))
    );

    return {
      ...row,
      finding_tags: findingTags,
      anatomy_tags: anatomyTags,
      modality_tags: modalityTags,
      updated_at: new Date().toISOString()
    };
  });

  writeJsonl(outputPath, normalized);
  console.log(`normalized=${normalized.length}`);
  console.log(`wrote=${outputPath}`);
}

main();
