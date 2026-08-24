#!/usr/bin/env node
/**
 * Writes a sha256 checksum file for every packaged installer under a
 * directory (electron-forge's `out/make` tree). Pure Node, no shell
 * tools, so it behaves identically across the macOS/Windows/Linux CI
 * runners instead of relying on shasum vs sha256sum vs Get-FileHash.
 *
 * Usage: node checksum.js <input-dir> <output-file>
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [, , inputDir, outFile] = process.argv;
if (!inputDir || !outFile) {
  console.error('usage: checksum.js <input-dir> <output-file>');
  process.exit(1);
}

const EXTENSIONS = new Set(['.zip', '.exe', '.nupkg', '.deb', '.rpm']);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (EXTENSIONS.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

const files = fs.existsSync(inputDir) ? walk(inputDir) : [];
const lines = files.map((file) => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return `${hash}  ${path.relative(process.cwd(), file)}`;
});

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, lines.length ? lines.join('\n') + '\n' : '');
console.log(lines.length ? lines.join('\n') : `no packaged artifacts found under ${inputDir}`);
