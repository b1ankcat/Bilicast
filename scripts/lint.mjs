import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CHECK_EXTENSIONS = new Set([".js", ".mjs"]);
const roots = ["src", "scripts"];

const files = [];
for (const root of roots) {
  await collectFiles(path.join(ROOT, root), files);
}

for (const file of files) {
  const relativeFile = path.relative(ROOT, file);
  const source = await readFile(file, "utf8");
  if (/^<<<<<<< /m.test(source) || /^=======$/m.test(source) || /^>>>>>>> /m.test(source)) {
    process.stderr.write(`Conflict markers found: ${relativeFile}\n`);
    process.exit(1);
  }
  if (!source.trim()) {
    process.stderr.write(`Empty source file: ${relativeFile}\n`);
    process.exit(1);
  }
}

try {
  const manifestText = await readFile(path.join(ROOT, "manifest.json"), "utf8");
  JSON.parse(stripBom(manifestText));
} catch (error) {
  process.stderr.write(`manifest.json is invalid: ${error.message}\n`);
  process.exit(1);
}

async function collectFiles(dir, output) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, output);
      continue;
    }
    if (CHECK_EXTENSIONS.has(path.extname(entry.name))) {
      output.push(fullPath);
    }
  }
}

function stripBom(text) {
  return text.replace(/^\uFEFF/, "");
}
