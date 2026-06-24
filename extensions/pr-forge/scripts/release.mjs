#!/usr/bin/env node
/**
 * PR Forge release helper.
 *
 * Usage:  node scripts/release.mjs <version>     e.g. node scripts/release.mjs 1.0.1
 *
 * Automates the repeatable parts of the AGENTS.md release contract:
 *   1. Bumps the version in package.json
 *   2. Rewrites the versioned VSIX filename in README.md
 *   3. Rebuilds and packages pr-forge-<version>.vsix in the extension root
 *
 * It does NOT commit, tag, or publish — those steps stay manual so you can
 * review the diff and the packaged artifact first.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error('Usage: node scripts/release.mjs <version>  (e.g. 1.0.1)');
    process.exit(1);
}

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const prev = pkg.version;
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`package.json: ${prev} -> ${version}`);

const readmePath = join(root, 'README.md');
let readme = readFileSync(readmePath, 'utf-8');
const before = readme;
readme = readme.replace(/pr-forge-\d+\.\d+\.\d+\.vsix/g, `pr-forge-${version}.vsix`);
if (readme !== before) {
    writeFileSync(readmePath, readme);
    console.log(`README.md: VSIX filename updated to pr-forge-${version}.vsix`);
}

console.log('Building...');
execSync('npm run build', { cwd: root, stdio: 'inherit' });
console.log('Packaging...');
execSync('npx vsce package --no-dependencies', { cwd: root, stdio: 'inherit' });

console.log(`\nDone. Next steps (manual):`);
console.log(`  - Review the diff and pr-forge-${version}.vsix`);
console.log(`  - git commit, tag v${version}, push`);
console.log(`  - npx vsce publish --no-dependencies`);
