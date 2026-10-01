// .htaccess Generator — Apache 2.4 access control and current header advice
//
// Read:  src/components/tools/HtaccessGeneratorTool.astro (extracts the real `lines()` function
//        between the `engine:start` / `engine:end` markers and runs it with stand-in form
//        controls, so this test cannot drift from the shipped source)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Apache 2.4 controls access with `Require` (mod_authz_core); `Order` / `Deny` are Apache 2.2
// directives that 2.4 accepts only when mod_access_compat is loaded (Apache "Upgrading to 2.4
// from 2.2"). The OWASP HTTP Headers Cheat Sheet and MDN advise `X-XSS-Protection: 0` (or not
// sending it), because the old XSS auditor could be abused; "1; mode=block" is what the tool
// wrote before.
//
// Run: node scripts/test-htaccess-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/HtaccessGeneratorTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in HtaccessGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const makeLines = new Function('els', block + '\nreturn lines;');

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

const off = { checked: false, value: '' };
function form(overrides) {
  const names = ['https', 'wwwEnable', 'indexEnable', 'cacheEnable', 'secEnable', 'secDirListing', 'secHtaccess', 'secEnvFiles', 'secXss', 'redirEnable'];
  const els = new Proxy({}, { get: (_, k) => overrides[k] || (names.includes(k) ? off : { checked: false, value: '' }) });
  return makeLines(els)();
}
const on = { checked: true, value: '' };
const all = form({ secEnable: on, secDirListing: on, secHtaccess: on, secEnvFiles: on, secXss: on });

check('no Apache 2.2 Order directive', !/^\s*Order\b/m.test(all), all);
check('no Apache 2.2 Deny directive', !/^\s*Deny from\b/m.test(all), all);
check('.htaccess is blocked with Require all denied', /<Files "\.htaccess">\n  Require all denied\n<\/Files>/.test(all), all);
check('.env is blocked with Require all denied', /<Files "\.env">\n  Require all denied\n<\/Files>/.test(all), all);
check('X-XSS-Protection is 0', /Header always set X-XSS-Protection "0"/.test(all), all);
check('X-XSS-Protection 1; mode=block is gone', !/mode=block/.test(all), all);
check('other headers kept', /X-Content-Type-Options "nosniff"/.test(all) && /X-Frame-Options "SAMEORIGIN"/.test(all), all);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
