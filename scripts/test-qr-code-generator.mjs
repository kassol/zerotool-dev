// QR Code Generator — a 4-module quiet zone
//
// Read:  src/components/tools/QrCodeGeneratorTool.astro (extracts the real `qrOptions`
//        between the `engine:start` / `engine:end` markers); public/vendor/qrcode.min.js
//        (the library the page loads, run in a vm context)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// ISO/IEC 18004 requires a quiet zone 4 modules wide around a QR Code symbol; the tool wrote 2.
// The options are passed to the vendor library, which renders an SVG; the SVG's viewBox is the
// module count plus the quiet zone on both sides.
//
// Run: node scripts/test-qr-code-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/QrCodeGeneratorTool.astro'), 'utf8');
const s = source.indexOf('/* ── engine:start ── */');
const e = source.indexOf('/* ── engine:end ── */');
if (s < 0 || e <= s) { console.error('FAIL: engine block not found'); process.exit(1); }
const { qrOptions } = new Function(source.slice(s, e) + '\nreturn { qrOptions };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) { if (ok) passes++; else { failures++; console.log('FAIL: ' + name + ' — ' + detail); } }

const opts = qrOptions(256, 'M', '#000000', '#ffffff');
check('quiet zone is 4 modules', opts.margin === 4, JSON.stringify(opts));
check('size and colors are passed', opts.width === 256 && opts.color.dark === '#000000' && opts.color.light === '#ffffff' && opts.errorCorrectionLevel === 'M', JSON.stringify(opts));

const ctx = { window: {}, self: {}, console, TextEncoder, Uint8Array };
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'public/vendor/qrcode.min.js'), 'utf8'), ctx);
const QR = ctx.QRCode;
const modules = QR.create('https://zerotool.dev', { errorCorrectionLevel: 'M' }).modules.size;
let svg = null;
QR.toString('https://zerotool.dev', { ...qrOptions(256, 'M', '#000000', '#ffffff'), type: 'svg' }, (err, out) => { svg = err ? String(err) : out; });
const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg || '');
check('rendered with 4 modules on each side', vb && Number(vb[1]) === modules + 8, (vb ? vb[0] : svg) + ' modules ' + modules);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
