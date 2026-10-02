// MIME Type Lookup — lookup table, magic-bytes signatures and the facts the mime type guide quotes
//
// Read:  src/components/tools/MimeTypeLookupTool.astro (evaluates the DB, EXT_INDEX and SIGNATURES
//        declarations between `var DB = [` and the `// ── Search panel ──` comment),
//        scripts/test-mime-type-lookup.fixtures.json (IANA registry rows for the DB entries, see its
//        `source` field), src/content/blog/mime-type-lookup-guide/{en,zh,ja,ko}.mdx,
//        src/content/tools/mime-type-lookup/{en,zh,ja,ko}.mdx
// Write: a temporary directory for the `mime-run` module (removed afterwards); stdout
// Exit:  0 if all PASS, 1 if any FAIL
//
// The guide's sniff table (`mime-sniff`) is rebuilt from its "First bytes" column: each row's bytes
// go through the tool's first-match loop and the result must equal the "Tool result" column (the
// File.type fallback uses the Chrome column, as the tool does). Counts and the registered /
// unregistered examples are checked against the fixture. The `mime-run` module is executed on
// generated files.
//
// Run: node scripts/test-mime-type-lookup.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/components/tools/MimeTypeLookupTool.astro'), 'utf8');
const a = src.indexOf('var DB = [');
const b = src.indexOf('// ── Search panel ──');
if (a < 0 || b <= a) { console.error('FAIL: DB / SIGNATURES block not found'); process.exit(1); }
const { DB, EXT_INDEX, SIGNATURES, GROUPS } = new Function(src.slice(a, b) + '\nreturn { DB, EXT_INDEX, SIGNATURES, GROUPS };')();
const fx = JSON.parse(readFileSync(join(root, 'scripts/test-mime-type-lookup.fixtures.json'), 'utf8'));

let passes = 0, failures = 0;
function check(name, ok, detail) { if (ok) passes++; else { failures++; console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : '')); } }

// the tool's sniff(): first matching signature, else File.type, else application/octet-stream
function sniff(bytes, fileType) {
  const m = SIGNATURES.find((s) => { try { return s.match(bytes); } catch { return false; } });
  return { mime: m ? m.mime : (fileType || 'application/octet-stream'), matched: !!m, container: !!(m && m.container) };
}

// ── 1. table and signatures ──
check('DB has 155 entries', DB.length === 155, DB.length);
check('37 signatures', SIGNATURES.length === 37, SIGNATURES.length);
check('every DB group is a chip group', DB.every((r) => GROUPS.includes(r[2])));
check('every signature MIME is in the DB', SIGNATURES.every((s) => DB.some((r) => r[0] === s.mime)));
check('fixture covers exactly the DB', Object.keys(fx.entries).length === DB.length && DB.every((r) => r[0] in fx.entries));
const registered = DB.filter((r) => fx.entries[r[0]] !== null).length;
const unregistered = DB.length - registered;
check('106 registered / 49 not', registered === 106 && unregistered === 49, registered + '/' + unregistered);
const obsolete = DB.filter((r) => /OBSOLETED in favor of text\/javascript/.test(fx.entries[r[0]] || '')).map((r) => r[0]).sort();
check('application/javascript and application/ecmascript are obsoleted', JSON.stringify(obsolete) === '["application/ecmascript","application/javascript"]', obsolete.join(','));
const extOf = (e) => (EXT_INDEX[e] || []).map((r) => r[0]).join(', ');
check('.js maps to both types', extOf('js') === 'application/javascript, text/javascript', extOf('js'));
check('.ts maps to video/mp2t and TypeScript', extOf('ts') === 'video/mp2t, text/x-typescript', extOf('ts'));
check('.xml maps to two types', extOf('xml') === 'application/xml, text/xml', extOf('xml'));
check('.ico maps to two types', extOf('ico') === 'image/x-icon, image/vnd.microsoft.icon', extOf('ico'));

// ── 2. the en guide ──
const guide = readFileSync(join(root, 'src/content/blog/mime-type-lookup-guide/en.mdx'), 'utf8');
{
  const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
  check('en guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const tpl = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m].filter((re) => re.test(guide));
  check('en guide has no template headings', tpl.length === 0, tpl.map(String).join(' '));
  check('en guide quotes 155 entries and 37 signatures', guide.includes('155 entries') && guide.includes('37 signatures'));
  check('en guide quotes the registered split', guide.includes(`${registered} of them are registered and ${unregistered} are not`));
  // registry counts table
  for (const [type, n] of Object.entries(fx.counts)) {
    const row = guide.match(new RegExp('^\\| `' + type + '` \\| ([0-9,]+) \\|', 'm'));
    check('registry row ' + type, row && Number(row[1].replace(/,/g, '')) === n, row && row[1]);
  }
  check('eleven top-level types', Object.keys(fx.counts).length === 11 && guide.includes('eleven top-level types'));
  // every type the guide lists as unregistered is unregistered, and the registered alternatives are registered
  for (const m of ['video/webm', 'audio/webm', 'audio/wav', 'audio/x-wav', 'image/x-icon', 'text/yaml', 'application/x-7z-compressed', 'video/x-matroska']) {
    check(m + ' is unregistered', fx.entries[m] === null, fx.entries[m]);
  }
  for (const m of ['image/vnd.microsoft.icon', 'application/yaml']) check(m + ' is registered', !!fx.entries[m]);

  // sniff table
  const start = guide.indexOf('{/* mime-sniff */}');
  check('en guide has mime-sniff', start >= 0);
  const rows = guide.slice(start).split('\n').filter((l) => l.startsWith('| `')).slice(0, 11);
  check('sniff table has 11 rows', rows.length === 11, rows.length);
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim());
    const name = cells[0].match(/`([^`]+)`/)[1];
    const hex = cells[1].match(/`([0-9A-F ]+)`/)[1].trim().split(/\s+/).map((h) => parseInt(h, 16));
    const bytes = new Uint8Array(64); bytes.set(hex);
    // the remaining bytes of these short headers do not change the match; trailing zeros stand in for them
    const tool = cells[2].match(/`([^`]+)`/)[1];
    const chromeType = (cells[3].match(/^`([^`]+)`$/) || [])[1] || '';
    const r = sniff(bytes.subarray(0, Math.max(hex.length, 16)), chromeType);
    check('sniff ' + name + ' → ' + tool, r.mime === tool, r.mime);
    check('sniff ' + name + ' container note', r.container === /ZIP container note/.test(cells[2]));
    check('sniff ' + name + ' no-signature note', !r.matched === /no signature/.test(cells[2]));
  }
  // the PNG renamed .jpg uses the full 8-byte PNG signature; a real JPEG header is not mistaken for it
  check('JPEG bytes are image/jpeg', sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])).mime === 'image/jpeg');
  check('tar magic at 257 is outside 64 bytes', !SIGNATURES.some((s) => s.mime === 'application/x-tar'));
}

// ── 3. the mime-run module ──
{
  const run = guide.match(/\{\/\* mime-run \*\/\}\s*```js\n([\s\S]*?)```/);
  check('en guide has mime-run', !!run);
  if (run) {
    const dir = mkdtempSync(join(tmpdir(), 'mime-guide-'));
    try {
      writeFileSync(join(dir, 'check-upload.mjs'), run[1]);
      const { checkUpload } = await import(join(dir, 'check-upload.mjs'));
      const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(100)]);
      const jpg = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(100)]);
      const pdf = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1');
      const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(40)]);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      const tiny = Buffer.from([0xff, 0xd8]);
      const files = { png, jpg, pdf, webp, svg, tiny };
      for (const [k, v] of Object.entries(files)) writeFileSync(join(dir, k), v);
      const cases = [
        ['png', 'cat.png', { ok: true, mime: 'image/png' }],
        ['png', 'photo.jpg', { ok: false, reason: 'content is image/png but the name ends in ".jpg"' }],
        ['jpg', 'IMG_0001.JPEG', { ok: true, mime: 'image/jpeg' }],
        ['pdf', 'invoice.pdf', { ok: true, mime: 'application/pdf' }],
        ['webp', 'hero.webp', { ok: true, mime: 'image/webp' }],
        ['webp', 'hero', { ok: false, reason: 'content is image/webp but the name ends in ""' }],
        ['svg', 'logo.svg', { ok: false, reason: 'file type not allowed' }],
        ['tiny', 'cut.jpg', { ok: false, reason: 'file type not allowed' }],
      ];
      for (const [f, name, want] of cases) {
        const got = await checkUpload(join(dir, f), name);
        check('checkUpload(' + f + ', ' + name + ')', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}

// ── 4. other language guides and tool pages keep the right counts ──
for (const lang of ['zh', 'ja', 'ko']) {
  const g = readFileSync(join(root, 'src/content/blog/mime-type-lookup-guide', lang + '.mdx'), 'utf8');
  check(lang + ' guide quotes 155 and 37', g.includes('155') && g.includes('37'));
  check(lang + ' guide does not say ~240 / ~30', !/240|約\s*30|约\s*30|약\s*30/.test(g));
  check(lang + ' guide does not say file-type reads like the browser tool', !/浏览器端工具一致|ツールと同じ要領|도구와 동일한 방식/.test(g));
}
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const p = readFileSync(join(root, 'src/content/tools/mime-type-lookup', lang + '.mdx'), 'utf8');
  check(lang + ' tool page does not say ~240 entries', !/240/.test(p));
  check(lang + ' tool page FAQ gives the registered split', p.includes(String(registered)) && p.includes(String(unregistered)) && !/snapshot of the IANA|精选快照|選定スナップショット|큐레이션 스냅샷/.test(p));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
