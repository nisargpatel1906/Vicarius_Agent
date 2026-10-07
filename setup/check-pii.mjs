#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const rootDir = process.cwd();
const patternsPath = path.join(rootDir, 'setup', 'pii-patterns.txt');

if (!fs.existsSync(patternsPath)) {
  console.log('[check:pii] No setup/pii-patterns.txt found. Skipping check.');
  process.exit(0);
}

const rawPatterns = fs.readFileSync(patternsPath, 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.length > 0 && !line.startsWith('#'));

if (rawPatterns.length === 0) {
  console.log('[check:pii] setup/pii-patterns.txt is empty.');
  process.exit(0);
}

// Get list of tracked and untracked git files (excluding ignored files)
let trackedFiles = [];
try {
  const output = execSync('git ls-files && git ls-files --others --exclude-standard', { encoding: 'utf8', shell: 'cmd.exe' });
  trackedFiles = Array.from(new Set(output.split(/\r?\n/).map(f => f.trim()).filter(Boolean)));
} catch (err) {
  console.error('[check:pii] Failed to query git ls-files:', err.message);
  process.exit(1);
}

let violations = [];

for (const relPath of trackedFiles) {
  // Skip binary files and the check script itself
  if (
    relPath === 'setup/check-pii.mjs' ||
    relPath === 'setup/pii-patterns.txt' ||
    relPath.endsWith('.png') ||
    relPath.endsWith('.ico') ||
    relPath.endsWith('.jpg') ||
    relPath.endsWith('.pdf') ||
    relPath.endsWith('.docx') ||
    relPath.endsWith('.pptx') ||
    relPath.endsWith('.zip')
  ) {
    continue;
  }

  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) continue;

  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of rawPatterns) {
        if (pattern.startsWith('/') && pattern.endsWith('/')) {
          const regex = new RegExp(pattern.slice(1, -1), 'i');
          if (regex.test(line)) {
            violations.push({ file: relPath, line: i + 1, pattern });
          }
        } else {
          if (line.toLowerCase().includes(pattern.toLowerCase())) {
            violations.push({ file: relPath, line: i + 1, pattern });
          }
        }
      }
    }
  } catch (readErr) {
    // Binary or unreadable file
  }
}

if (violations.length > 0) {
  console.error(`\n❌ [check:pii] DETECTED ${violations.length} POTENTIAL PII/CREDENTIAL LEAKS IN TRACKED FILES:`);
  for (const v of violations) {
    console.error(`   - ${v.file}:${v.line} -> matches [${v.pattern}]`);
  }
  console.error('\nPlease redact these items before committing or publishing.\n');
  process.exit(1);
} else {
  console.log(`\n✅ [check:pii] Scanned ${trackedFiles.length} tracked files. Zero PII/credential leaks detected!\n`);
  process.exit(0);
}
