// Web security best practices (blog, en) — runnable code blocks and the tool facts the page quotes
//
// Read:  src/content/blog/web-security-best-practices/en.mdx and the tool components it describes
// Write: stdout only (test results); temporary files under the OS temp directory
// Exit:  0 if all PASS, 1 if any FAIL
//
// Code blocks preceded by {/* ws-run: {"lang":"node|python","expect":"…"} */} are run and their
// stdout must equal expect (a missing python3 is a SKIP). The OWASP Top 10:2025 table must list the
// ten categories in order (names as published at owasp.org/Top10/2025/, read 2026-10-02). The
// sentences about site tools are checked against the components: bcrypt cost range and default,
// the CSP generator's nonce placeholder, the Hash Generator having no Base64 output, the HTTP
// Header Analyzer hints and header count.
//
// Run: node scripts/test-web-security-best-practices.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let passes = 0, failures = 0, skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + (detail !== undefined ? '\n  ' + detail : '')); }
}
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const rel = 'src/content/blog/web-security-best-practices/en.mdx';
const text = read(rel);

const top10 = ['Broken Access Control', 'Security Misconfiguration', 'Software Supply Chain Failures',
  'Cryptographic Failures', 'Injection', 'Insecure Design', 'Authentication Failures',
  'Software or Data Integrity Failures', 'Security Logging and Alerting Failures', 'Mishandling of Exceptional Conditions'];
top10.forEach((name, i) => {
  const id = 'A' + String(i + 1).padStart(2, '0');
  check(`Top 10 row ${id} ${name}`, text.includes(`| ${id} | ${name} |`));
});

const bcrypt = read('src/components/tools/BcryptGeneratorTool.astro');
check('bcrypt cost choice is 4–31, default 12', /length: 28 \}, \(_, i\) => i \+ 4/.test(bcrypt) && /selected=\{c === 12\}/.test(bcrypt) && text.includes('cost factor from 4 to 31 (default 12)'));
const csp = read('src/components/tools/CspHeaderGeneratorTool.astro');
check("CSP generator uses the 'nonce-{RANDOM}' placeholder", csp.includes("'nonce-{RANDOM}'") && text.includes("'nonce-{RANDOM}'"));
const hash = read('src/components/tools/HashGeneratorTool.astro');
check('Hash Generator has no Base64 output', !/base64/i.test(hash) && text.includes('outputs hexadecimal'));
const hha = read('src/components/tools/HttpHeaderAnalyzerTool.astro');
check('HTTP Header Analyzer hints quoted on the page exist', hha.includes('max-age < 1 year') && hha.includes("'unsafe-inline' defeats") && hha.includes('Missing HttpOnly') && hha.includes('Missing Secure'));
check('HTTP Header Analyzer page states 88 headers', read('src/content/tools/http-header-analyzer/en.mdx').includes('88 headers') && text.includes('describes 88 headers'));

const h2 = [...text.matchAll(/^## (.+)$/gm)].map((x) => x[1]);
check('no template headings', !h2.some((h) => /^what (is|are)\b|online|\bin (code|javascript|python)\b|summary|conclusion/i.test(h)), h2.join(' | '));
check('is indexable', !/^noindex:\s*true/m.test(text));
const other = ['zh', 'ja', 'ko'].map((l) => (read(`src/content/blog/web-security-best-practices/${l}.mdx`).match(/^## /gm) || []).length);
check('en H2 count differs from zh / ja / ko', !other.includes(h2.length), h2.length + ' vs ' + other.join(','));

const hasPython = !spawnSync('python3', ['--version']).error;
const tmp = mkdtempSync(join(tmpdir(), 'web-security-'));
let runs = 0;
try {
  for (const m of text.matchAll(/\{\/\* ws-run: (\{.*?\}) \*\/\}\s*```([a-z]*)\n([\s\S]*?)```/g)) {
    runs++;
    const spec = JSON.parse(m[1]);
    const name = `${rel} ${spec.lang} block ${runs}`;
    let out;
    if (spec.lang === 'node') {
      const file = join(tmp, `b${runs}.mjs`);
      writeFileSync(file, m[3]);
      out = spawnSync(process.execPath, [file], { encoding: 'utf8' });
    } else if (hasPython) {
      out = spawnSync('python3', ['-c', m[3]], { encoding: 'utf8' });
    } else { skips++; console.log('SKIP ' + name + ' (python3 not found)'); continue; }
    check(name, out.status === 0 && out.stdout.trimEnd() === spec.expect, out.stdout + out.stderr);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
check('runnable blocks found', runs >= 8, runs);

console.log(`\n${passes} passed, ${failures} failed, ${skips} skipped`);
process.exit(failures ? 1 : 0);
