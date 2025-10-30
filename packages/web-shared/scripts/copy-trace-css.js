#!/usr/bin/env node

const { copyFileSync, mkdirSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const SRC_DIR = join(__dirname, '..', 'src', 'trace-viewer');
const DEST_DIR = join(__dirname, '..', 'dist', 'trace-viewer');

mkdirSync(DEST_DIR, { recursive: true });

for (const entry of readdirSync(SRC_DIR)) {
  const srcPath = join(SRC_DIR, entry);
  if (statSync(srcPath).isFile() && entry.endsWith('.css')) {
    const destPath = join(DEST_DIR, entry);
    copyFileSync(srcPath, destPath);
    console.log(`Copied ${srcPath} -> ${destPath}`);
  }
}
