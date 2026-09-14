#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FRONTEND = path.join(ROOT, "frontend/src");

function walk(dir, pred, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist") continue;
      walk(p, pred, out);
    } else if (pred(p)) out.push(p);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p);
}

const brewFiles = walk(FRONTEND, (p) => {
  if (!/\.(ts|tsx)$/.test(p)) return false;
  if (p.includes(".d.ts")) return false;
  const r = rel(p);
  return (
    r.includes("/brew/") ||
    /\/(brew|brewApi|brewlia|brewPreview|brewPageSeo|brewSubject|brewSyncConflict|brewRevisionChain|brewItemState|useBrewKeyboard)\b/.test(
      r,
    )
  );
});

const allSrc = walk(FRONTEND, (p) => /\.(ts|tsx)$/.test(p) && !p.includes(".d.ts"));
const tests = walk(path.join(ROOT, "frontend/tests"), (p) => /\.(ts|tsx)$/.test(p));
const searchFiles = [...allSrc, ...tests];

const fileContents = new Map();
for (const f of searchFiles) fileContents.set(f, fs.readFileSync(f, "utf8"));

function extractExports(src, file) {
  const exports = [];
  const add = (name, kind, line) => {
    if (!name || name === "default") return;
    exports.push({ name, kind, line, file });
  };
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const n = i + 1;
    let m;
    if ((m = line.match(/^export\s+(?:async\s+)?function\s+(\w+)/))) add(m[1], "function", n);
    else if ((m = line.match(/^export\s+(?:async\s+)?function\*\s+(\w+)/))) add(m[1], "function", n);
    else if ((m = line.match(/^export\s+class\s+(\w+)/))) add(m[1], "class", n);
    else if ((m = line.match(/^export\s+(?:const|let|var)\s+(\w+)/))) add(m[1], "const", n);
    else if ((m = line.match(/^export\s+type\s+(\w+)/))) add(m[1], "type", n);
    else if ((m = line.match(/^export\s+interface\s+(\w+)/))) add(m[1], "interface", n);
    else if ((m = line.match(/^export\s+enum\s+(\w+)/))) add(m[1], "enum", n);
    else if ((m = line.match(/^export\s+\{([^}]+)\}/))) {
      for (const part of m[1].split(",")) {
        const p = part.trim();
        if (!p) continue;
        const as = p.match(/^(\w+)\s+as\s+(\w+)$/);
        add(as ? as[2] : p.replace(/\s+as\s+\w+$/, "").trim(), "reexport", n);
      }
    }
  }
  return exports;
}

const results = [];
for (const file of brewFiles) {
  if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
  const src = fileContents.get(file);
  if (!src) continue;
  for (const exp of extractExports(src, file)) {
    const name = exp.name;
    const ident = new RegExp(`\\b${name}\\b`);
    const usages = [];
    for (const [f, text] of fileContents) {
      if (f === file) continue;
      if (!ident.test(text)) continue;
      usages.push(rel(f));
    }
    const prod = usages.filter((u) => !u.includes(".test.") && !u.includes("/tests/"));
    const testOnly = usages.filter((u) => u.includes(".test.") || u.includes("/tests/"));
    results.push({
      name,
      kind: exp.kind,
      line: exp.line,
      file: rel(file),
      prodCount: prod.length,
      testCount: testOnly.length,
      prod,
      testOnly,
    });
  }
}

const unused = results.filter((r) => r.prodCount === 0 && r.testCount === 0);
const testOnly = results.filter((r) => r.prodCount === 0 && r.testCount > 0);

// Files never imported
const importHits = new Map();
for (const file of brewFiles) {
  if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
  const base = path.basename(file).replace(/\.(tsx?)$/, "");
  const dir = path.dirname(file);
  const pats = [
    new RegExp(`from ['"][^'"]*/${base}['"]`),
    new RegExp(`from ['"]\\./${base}['"]`),
    new RegExp(`from ['"]\\.\\./[^'"]*/${base}['"]`),
    new RegExp(`import\\(['"][^'"]*/${base}['"]\\)`),
  ];
  const hits = [];
  for (const [f, text] of fileContents) {
    if (f === file) continue;
    if (pats.some((p) => p.test(text))) hits.push(rel(f));
  }
  importHits.set(rel(file), hits);
}

const unusedFiles = [...importHits.entries()].filter(([, hits]) => hits.length === 0);

console.log("=== UNUSED EXPORTS (no refs at all) ===");
for (const r of unused) {
  console.log(`${r.file}:${r.line}  ${r.kind} ${r.name}`);
}
console.log(`\ncount=${unused.length}`);

console.log("\n=== TEST-ONLY EXPORTS ===");
for (const r of testOnly) {
  console.log(`${r.file}:${r.line}  ${r.kind} ${r.name}  tests=${r.testOnly.join(",")}`);
}
console.log(`\ncount=${testOnly.length}`);

console.log("\n=== NEVER IMPORTED FILES ===");
for (const [f, hits] of unusedFiles) {
  console.log(f);
}
console.log(`\ncount=${unusedFiles.length}`);
