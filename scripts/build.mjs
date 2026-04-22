import { promises as fs } from "fs";
import path from "path";

const outdir = "dist";
const args = process.argv.slice(2);
const isClean = args.includes("--clean");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function pathExists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(src, dest) {
  if (!(await pathExists(src))) return;
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
  console.log(`copied ${src} -> ${dest}`);
}

async function copyDirectory(srcDir, destDir) {
  if (!(await pathExists(srcDir))) return;
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  await ensureDir(destDir);
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

async function clean() {
  await fs.rm(outdir, { recursive: true, force: true });
  console.log("dist cleaned");
}

async function build() {
  await clean();
  await copyFile("manifest.json", path.join(outdir, "manifest.json"));
  await copyDirectory("src", path.join(outdir, "src"));
  await copyDirectory("icons", path.join(outdir, "icons"));
  console.log("Assets ready in dist/ folder");
}

(async () => {
  if (isClean) {
    await clean();
  } else {
    await build();
  }
})().catch((error) => {
  void error;
  process.exit(1);
});
