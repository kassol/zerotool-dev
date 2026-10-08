// Text to ASCII Art — output matches figlet 2.2.5 character for character
//
// Read:  src/components/tools/TextToAsciiArtTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers, the frontmatter STRINGS table and FONT_NAMES),
//        public/figlet-fonts/*.flf (the fonts the page loads),
//        scripts/test-text-to-ascii-art.fixtures.json (figlet 2.2.5 output hashes),
//        src/content/tools/text-to-ascii-art/{en,zh,ja,ko}.mdx (annotated examples), package.json,
//        src/layouts/ToolLayout.astro (real Ctrl/Cmd+L handler in PNG export regression),
//        src/data/tool-layouts.ts (v2 layout registration)
// Write: stdout only (test results). With --regenerate only: the fixtures file, plus temporary
//        files under os.tmpdir() that are removed afterwards.
// Exit:  0 if all PASS, 1 if any FAIL
//
// Reference: figlet 2.2.5 (github.com/cmatsuoka/figlet, tag 2.2.5, figlet.c), run with
// `-C utf8 -d <the page's fonts>` and -W / -k / -S / -o / -w as the tool's options map them.
// The fixtures hold the SHA-256 (first 16 hex digits) of its output for 12 fonts × 5 layouts ×
// 10 texts without a width limit (printable ASCII, Latin-1, ಠ, CJK and emoji that the fonts
// lack, tab and control characters, several lines with an empty one, smushing pairs) and for
// word wrap at -w 8 / 20 / 30 / 45 / 80 (word breaks, one long word, runs of spaces, a letter
// wider than the line). Before the fix the page used figlet.js 1.11, whose output differed
// from figlet for 8 of the 12 fonts on "Hello World": an extra blank first column (Standard,
// Big, Banner, Block, Script, Small) and no overlapping in Mini and Shadow, whose header asks
// for universal smushing.
// Also covers: the shown `figlet` command reproduces the output (recorded by running it at
// generation time with the figlet 2.2.5 distribution fonts and ./Font.flf files), font files
// are left-to-right with rows of equal width, characters reported as skipped render like a
// missing character, tab becomes a space, copy formats (Markdown fence longer than any run of
// backticks, # and // comments, heredoc delimiter that no line equals, trimming), download
// names, PNG size limits, the input limit and its render time, every annotated example and the
// width table in the four tool pages, the 4 language STRINGS tables.
// 2026-10-08 (S2-5): analytics and copy run through the real page script with a fake DOM.
// Before, the page sent `generate` on the first input event of each page load and nothing for
// copy or download; Copy only used the Clipboard API, so a missing or rejected API meant no copy.
// Now one event per committed action, and Copy falls back to execCommand('copy') before showing
// copyFailed.
//
// Run:        node scripts/test-text-to-ascii-art.mjs
// Regenerate: node scripts/test-text-to-ascii-art.mjs --regenerate /path/to/figlet-2.2.5
//             (a source tree built with `make figlet`; uses ./figlet and ./fonts)

import { readFileSync, writeFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/TextToAsciiArtTool.astro'), 'utf8');
const fixturePath = join(root, 'scripts/test-text-to-ascii-art.fixtures.json');
const fontDir = join(root, 'public/figlet-fonts');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in TextToAsciiArtTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) +
  '\nreturn { MAX_INPUT, parseFont, renderFiglet, inputCodes, unsupportedChars, skippedMessage, formatOutput, figletCommand, downloadBase, imageLayout, fill };')();

// Frontmatter constants: one line ending in ';', or a block closed by '\n};'.
function sliceConst(name) {
  const s = source.indexOf('const ' + name + ' = ');
  if (s < 0) return null;
  const lineEnd = source.indexOf('\n', s);
  const e = source[lineEnd - 1] === ';' ? lineEnd : source.indexOf('\n};', s) + 3;
  return new Function(source.slice(s, e) + '\nreturn ' + name + ';')();
}
const STRINGS = sliceConst('STRINGS');
const FONT_NAMES = sliceConst('FONT_NAMES');

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const fontNames = readdirSync(fontDir).filter((f) => f.endsWith('.flf')).map((f) => f.slice(0, -4)).sort();
const fonts = Object.fromEntries(fontNames.map((n) => [n, E.parseFont(readFileSync(join(fontDir, n + '.flf'), 'utf8'))]));
const render = (font, text, layout = 'default', width = 0) => E.renderFiglet(fonts[font], text, { layout, width }).join('\n');

// ---------- the reference cases (shared by the test and --regenerate) ----------
const ASCII = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).join('');
const TEXTS = [
  ASCII, 'Hello World', 'Deploy', '  a b  c  ', 'ÄÖÜ äöü ß café Ω ಠ_ಠ', 'Hi 中文 OK 😀',
  'a\tb\u0001c\u007fd', 'Line one\nLine 2\n\nEnd\n', '()[]{}<>\\/|_-', 'ZeroTool v1.2',
  'The quick brown fox jumps over the lazy dog', 'Supercalifragilisticexpialidocious',
  'a  b   c    d e', 'W W W',
];
const LAYOUTS = ['default', 'full', 'fitted', 'smush', 'overlap'];
const FLAGS = { default: [], full: ['-W'], fitted: ['-k'], smush: ['-S'], overlap: ['-o'] };
function referenceCases() {
  const cases = [];
  for (const f of fontNames) for (const l of LAYOUTS) for (let t = 0; t < 10; t++) cases.push([f, l, 0, t]);
  for (const f of fontNames) for (const w of [8, 20, 45, 80]) for (const t of [10, 11, 12, 13]) cases.push([f, 'default', w, t]);
  for (const f of fontNames) for (const l of ['full', 'overlap']) for (const w of [30, 80]) cases.push([f, l, w, 10]);
  return cases;
}
const COMMAND_CASES = [
  ...fontNames.map((f) => [f, 'default', 0, 'Hello World']),
  ['Standard', 'fitted', 0, "It's"],
  ['Standard', 'default', 0, 'ಠ_ಠ'],
  ['Slant', 'smush', 40, 'Line one\nLine two'],
  ['Mini', 'overlap', 0, '-v'],
  ['Big', 'full', 120, 'café'],
  ['Block', 'default', 0, 'Hello World'],
  ['Standard', 'default', 0, '中'.repeat(450) + 'OK'],
  ['Shadow', 'default', 60, 'two words'],
  ['Doom', 'default', 0, 'Hi\n'],
  ['Small', 'default', 80, 'a  b'],
  ['Banner', 'default', 0, 'テスト'],
  ['Standard', 'full', 0, 'Qiita'],
];

// ---------- --regenerate ----------
if (process.argv[2] === '--regenerate') {
  const src = process.argv[3];
  if (!src) { console.error('usage: --regenerate /path/to/figlet-2.2.5'); process.exit(1); }
  const bin = join(src, 'figlet');
  const tmp = mkdtempSync(join(tmpdir(), 'taa-fixtures-'));
  try {
    const fd = join(tmp, 'fonts');
    mkdirSync(fd);
    for (const f of fontNames) copyFileSync(join(fontDir, f + '.flf'), join(fd, f + '.flf'));
    copyFileSync(join(src, 'fonts/utf8.flc'), join(fd, 'utf8.flc'));
    const run = (font, layout, width, text) => execFileSync(bin, ['-C', 'utf8', '-d', fd, '-f', font, ...FLAGS[layout], '-w', String(width || 100000)], { input: text }).toString();
    const strip = (out) => out.replace(/\n$/, '');
    const cases = referenceCases().map(([f, l, w, t]) => [f, l, w, t, hash(strip(run(f, l, w, TEXTS[t])))]);
    const pathBin = join(tmp, 'bin');
    mkdirSync(pathBin);
    symlinkSync(bin, join(pathBin, 'figlet'));
    const commands = COMMAND_CASES.map(([f, l, w, text]) => {
      const lines = E.renderFiglet(fonts[f], text, { layout: l, width: w });
      const cmd = E.figletCommand(f, l, w, text, lines).command;
      const out = execFileSync('/bin/sh', ['-c', cmd], { cwd: fontDir, env: { PATH: pathBin + ':/usr/bin:/bin', FIGLET_FONTDIR: join(src, 'fonts'), LC_ALL: 'C' } }).toString();
      return [f, l, w, text, cmd, hash(strip(out))];
    });
    writeFileSync(fixturePath, JSON.stringify({
      reference: 'figlet 2.2.5 (github.com/cmatsuoka/figlet tag 2.2.5) with -C utf8 and the fonts in public/figlet-fonts; commands run with FIGLET_FONTDIR set to the figlet 2.2.5 fonts directory and the working directory public/figlet-fonts',
      hash: 'sha256 of the output without its final newline, first 16 hex digits',
      texts: TEXTS,
      cases,
      commands,
    }, null, 0).replace(/\],\[/g, '],\n[') + '\n');
    console.log('wrote ' + cases.length + ' cases and ' + commands.length + ' commands');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(0);
}

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}

// ---------- fonts ----------
eq('menu lists exactly the fonts in public/figlet-fonts', [...FONT_NAMES].sort(), fontNames);
eq('12 fonts', fontNames.length, 12);
for (const n of fontNames) {
  const raw = readFileSync(join(fontDir, n + '.flf'));
  check(n + ': file is ASCII without tabs', raw.every((b) => b < 128 && b !== 9));
  const f = fonts[n];
  check(n + ': left to right (the renderer has no right-to-left path)', f.direction === 0, f.direction);
  let uneven = 0, wide = 0;
  for (const rows of f.chars.values()) {
    if (rows.some((r) => r.length !== rows[0].length)) uneven++;
    if (rows.some((r) => r.length >= 255)) wide++;
  }
  eq(n + ': every glyph has rows of equal width', uneven, 0);
  eq(n + ': rows shorter than figlet MAXLEN 255', wide, 0);
  check(n + ': U+E000 is not defined (used below as the missing character)', !f.chars.has(0xE000));
}
check('not an flf file is rejected', (() => { try { E.parseFont('<html>404</html>\n'); return false; } catch { return true; } })());

// ---------- figlet 2.2.5 reference ----------
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
eq('fixture texts match the test', fixtures.texts, TEXTS);
eq('fixture cases match the test', fixtures.cases.map((c) => c.slice(0, 4)), referenceCases());
let refFail = 0;
for (const [f, l, w, t, h] of fixtures.cases) {
  const got = hash(render(f, TEXTS[t], l, w));
  if (got !== h) { refFail++; if (refFail <= 5) check('figlet 2.2.5: ' + JSON.stringify([f, l, w, TEXTS[t].slice(0, 30)]), false, got + ' ≠ ' + h); }
  else passes++;
}
if (refFail > 5) check('figlet 2.2.5: ' + refFail + ' cases differ in total', false);
check('figlet 2.2.5 cases: at least 800', fixtures.cases.length >= 800, fixtures.cases.length);

eq('fixture commands match the test', fixtures.commands.map((c) => c.slice(0, 4)), COMMAND_CASES);
for (const [f, l, w, text, cmd, h] of fixtures.commands) {
  const lines = E.renderFiglet(fonts[f], text, { layout: l, width: w });
  eq('command for ' + JSON.stringify([f, l, w, text.slice(0, 12)]), E.figletCommand(f, l, w, text, lines).command, cmd);
  eq('command output equals the page for ' + JSON.stringify([f, l, w, text.slice(0, 12)]), hash(lines.join('\n')), h);
}

// ---------- the defect: figlet.js output ----------
eq('Standard "Hi" starts in column 0 (figlet.js put a blank column first)', render('Standard', 'Hi').split('\n'), [
  ' _   _ _ ', '| | | (_)', '| |_| | |', '|  _  | |', '|_| |_|_|', '         ']);
eq('Mini overlaps letters as its header asks (universal smushing)', render('Mini', 'Hello World').split('\n'), [
  '                           ',
  '|_| _ || _  \\    /_ ._| _| ',
  '| |(/_||(_)  \\/\\/(_)| |(_| ',
  '                           ']);
check('figlet.js is no longer bundled', !/from ['"]figlet['"]/.test(source));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
check('figlet.js dependency removed', !(pkg.dependencies && pkg.dependencies.figlet) && !(pkg.devDependencies && pkg.devDependencies.figlet));

// ---------- input handling ----------
eq('tab becomes a space, \\r \\v \\f become line breaks, other controls are dropped',
  E.inputCodes('a\tb\rc\u000bd\u000ce\u0001f\u007fg'), [97, 32, 98, 10, 99, 10, 100, 10, 101, 102, 103]);
eq('code points, not UTF-16 units', E.inputCodes('😀'), [0x1F600]);
eq('tab renders as a space', render('Standard', 'a\tb'), render('Standard', 'a b'));
eq('empty text renders nothing', E.renderFiglet(fonts.Standard, '', {}), []);
eq('a line break alone prints one empty block', E.renderFiglet(fonts.Standard, '\n', {}), ['', '', '', '', '', '']);
eq('a final line break adds nothing', render('Standard', 'a\n'), render('Standard', 'a'));
eq('two line breaks print one empty block', E.renderFiglet(fonts.Standard, 'a\n\nb', {}).length, 18);

// ---------- skipped characters ----------
const std = fonts.Standard;
eq('CJK characters reported', E.unsupportedChars('Hi 中文', std), ['中', '文']);
eq('kana and Hangul reported', E.unsupportedChars('カナ한글', std), ['カ', 'ナ', '한', '글']);
eq('each character once, in input order', E.unsupportedChars('中a中b文中', std), ['中', '文']);
eq('emoji is one entry', E.unsupportedChars('ok 😀', std), ['😀']);
eq('ASCII text has nothing to report', E.unsupportedChars('Hello, World! 123', std), []);
eq('Latin-1 letters defined by the font are not reported', E.unsupportedChars('ÄÖÜäöüß', std), []);
eq('é and ಠ are in Standard, Ω is not', E.unsupportedChars('café ಠ_ಠ Ω', std), ['Ω']);
eq('3D-ASCII draws nothing for ( ) _ { } and ~', E.unsupportedChars('f(x) a_b {~}', fonts['3D-ASCII']), ['(', ')', '_', '{', '~', '}']);
eq('tab and line breaks are not reported', E.unsupportedChars('a\tb\nc\r\nd', std), []);
eq('control characters are reported (figlet drops them)', E.unsupportedChars('a\u0001b\u007f', std), ['\u0001', '\u007f']);
eq('message lists characters', E.skippedMessage('Skipped in {font}: {chars}', 'Standard', ['中', '文']), 'Skipped in Standard: 中 文');
eq('invisible characters written as U+XXXX', E.skippedMessage('{chars}', 'Standard', ['\u0001', '\u00a0', '\u200b', 'é']), 'U+0001 U+00A0 U+200B é');
eq('astral code point written in full', E.skippedMessage('{chars}', 'x', ['\u{E0041}']), 'U+E0041');
eq('3D-ASCII skips 14 punctuation marks', E.unsupportedChars(ASCII, fonts['3D-ASCII']).join(''), '"\'()+=@\\_`{|}~');
eq('3D-ASCII skips the umlauts', E.unsupportedChars('ÄÖÜäöüß', fonts['3D-ASCII']).join(''), 'ÄÖÜäöüß');
eq('CJK, kana, Hangul and emoji are in none of the 12 fonts', fontNames.filter((n) => E.unsupportedChars('你こ안😀', fonts[n]).length !== 4), []);
eq('Standard has all printable ASCII', E.unsupportedChars(ASCII, std), []);
// A reported character renders exactly like a character the font lacks (figlet inserts an
// empty glyph, which also stops the neighbours from overlapping) or like nothing at all
// (dropped control characters); an unreported one draws something.
const probes = [...ASCII, '中', 'カ', '한', '😀', 'é', 'Ä', 'ß', '€', '©', 'Ω', 'ಠ', '\u0001'];
for (const n of fontNames) {
  for (const ch of probes) {
    const reported = E.unsupportedChars(ch, fonts[n]).length === 1;
    const out = render(n, 'A' + ch + 'B');
    const asMissing = out === render(n, 'A\uE000B') || out === render(n, 'AB');
    check(n + ': ' + JSON.stringify(ch) + (reported ? ' reported and draws nothing' : ' not reported and draws something'), reported === asMissing);
  }
}

// ---------- copy formats ----------
const art = ['  _ ', ' | |  ', '', '```x', ''];
eq('plain keeps trailing spaces', E.formatOutput(art, 'plain', false), '  _ \n | |  \n\n```x\n');
eq('trim removes trailing spaces and blank lines at both ends', E.formatOutput(['', ' a  ', '', 'b ', '  ', ''], 'plain', true), ' a\n\nb');
eq('Markdown fence is longer than any run of backticks', E.formatOutput(['a``` b', 'c'], 'markdown', true), '````\na``` b\nc\n````');
eq('Markdown fence is at least 3', E.formatOutput(['a'], 'markdown', true), '```\na\n```');
eq('# comments, empty line gets a bare #', E.formatOutput(['a', '', 'b'], 'hash', true), '# a\n#\n# b');
eq('// comments', E.formatOutput(['a', '', 'b'], 'slash', true), '// a\n//\n// b');
eq('heredoc with a quoted delimiter', E.formatOutput(['a$b', '`c`'], 'heredoc', true), "cat <<'EOF'\na$b\n`c`\nEOF");
eq('heredoc delimiter that no line equals', E.formatOutput(['EOF', 'EOF2'], 'heredoc', true), "cat <<'EOF3'\nEOF\nEOF2\nEOF3");

// ---------- figlet command ----------
const cmd = (f, text, l = 'default', w = 0) => E.figletCommand(f, l, w, text, E.renderFiglet(fonts[f], text, { layout: l, width: w }));
eq('plain command', cmd('Standard', 'Hello World').command, "figlet -f standard 'Hello World'");
eq('single quote escaped', cmd('Standard', "It's").command, "figlet -f standard 'It'\\''s'");
eq('layout flags', ['full', 'fitted', 'smush', 'overlap'].map((l) => cmd('Slant', 'Hi', l).command.split(' ')[3]), ['-W', '-k', '-S', '-o']);
eq('width 80 is figlet\'s default and is left out', cmd('Standard', 'Hi', 'default', 80).command, "figlet -f standard 'Hi'");
eq('other widths are written', cmd('Standard', 'Hi', 'default', 40).command, "figlet -f standard -w 40 'Hi'");
eq('no limit: -w is the widest line + 1 when that exceeds 80', cmd('Block', 'Hello World').command, "figlet -f block -w 93 'Hello World'");
eq('non-ASCII text adds -C utf8', cmd('Big', 'café').command, "figlet -C utf8 -f big 'café'");
eq('text starting with - is preceded by --', cmd('Mini', '-v').command, "figlet -f mini -- '-v'");
eq('Doom and 3D-ASCII are not in the figlet distribution: use the file', [cmd('Doom', 'Hi'), cmd('3D-ASCII', 'Hi')].map((c) => [c.command, c.fontFile]),
  [["figlet -f ./Doom.flf 'Hi'", 'Doom.flf'], ["figlet -f ./3D-ASCII.flf 'Hi'", '3D-ASCII.flf']]);
eq('Shadow here has a wider space than figlet\'s shadow.flf: use the file', cmd('Shadow', 'Hi').fontFile, 'Shadow.flf');
eq('ಠ is only in this site\'s Standard', [cmd('Standard', 'Hi').fontFile, cmd('Standard', 'ಠ_ಠ').fontFile], [null, 'Standard.flf']);
eq('empty text has no command', E.figletCommand('Standard', 'default', 0, '', []), null);

// ---------- download name and PNG size ----------
eq('download name from the text and font', E.downloadBase('Hello, World!', 'Standard'), 'hello-world-standard');
eq('download name without letters falls back', E.downloadBase('中文 😀', '3D-ASCII'), 'ascii-art-3d-ascii');
eq('download name drops accents and caps at 40', E.downloadBase('Café ' + 'x'.repeat(60), 'Big'), 'cafe-' + 'x'.repeat(35) + '-big');
eq('PNG at 2x when it fits', E.imageLayout(53, 6, 8.4), { width: 478, height: 134, scale: 2 });
eq('PNG falls back to 1x', E.imageLayout(1500, 10, 8.4).scale, 1);
eq('PNG too large for a canvas', E.imageLayout(19511, 10, 8.4), null);

// ---------- input limit ----------
eq('input limit', E.MAX_INPUT, 2000);
{
  const long = 'The quick brown fox jumps over the lazy dog. '.repeat(50).slice(0, E.MAX_INPUT);
  const t0 = performance.now();
  for (const n of fontNames) E.renderFiglet(fonts[n], long, { layout: 'overlap' });
  const ms = performance.now() - t0;
  check('12 fonts × ' + E.MAX_INPUT + ' characters without a width limit in under 1.5 s (' + Math.round(ms) + ' ms)', ms < 1500 * PERF_SLACK);
}

// ---------- examples in the tool pages ----------
// Each art block in the pages is preceded by {/* figlet: {...} */} with font, layout, width,
// text and trim; the block must equal the engine output.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/text-to-ascii-art/' + lang + '.mdx'), 'utf8');
  const re = /\{\/\* figlet: (\{.*?\}) \*\/\}\n+```text\n([\s\S]*?)\n```/g;
  let m, count = 0;
  while ((m = re.exec(mdx))) {
    count++;
    const o = JSON.parse(m[1]);
    const lines = E.renderFiglet(fonts[o.font], o.text, { layout: o.layout || 'default', width: o.width || 0 });
    eq(lang + ' page example ' + count + ' (' + o.font + ', ' + JSON.stringify(o.text) + ')', m[2], E.formatOutput(lines, 'plain', true));
  }
  check(lang + ' page has at least 3 annotated examples', count >= 3, count);
  // Width table rows: | Font | lines | columns | letters of ABC…Z per block at width 80 |
  const rows = [...mdx.matchAll(/^\| (Standard|Banner|Big|Block|Doom|Lean|Mini|Script|Shadow|Slant|Small|3D-ASCII) \| (\d+) \| (\d+) \| (\d+) \|$/gm)];
  check(lang + ' page has a width table', rows.length >= 7, rows.length);
  for (const r of rows) {
    const f = r[1];
    const t = E.formatOutput(E.renderFiglet(fonts[f], 'Hello World', {}), 'plain', true).split('\n');
    let k = 0;
    for (let i = 1; i <= 26; i++) { if (E.renderFiglet(fonts[f], ASCII.slice(32, 32 + i), { width: 80 }).length === fonts[f].height) k = i; else break; }
    eq(lang + ' width table ' + f, [Number(r[2]), Number(r[3]), Number(r[4])], [t.length, Math.max(...t.map((l) => l.length)), k]);
  }
  check(lang + ' page has no unannotated ```text block', (mdx.match(/```text\n/g) || []).length === count);
}

// ---------- STRINGS ----------
const keyPaths = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keyPaths(v, p + k + '.') : [p + k])).sort();
for (const lang of ['zh', 'ja', 'ko']) eq(lang + ' STRINGS keys equal en', keyPaths(STRINGS[lang]), keyPaths(STRINGS.en));
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const s = STRINGS[lang];
  check(lang + ': skipped has {font} and {chars}', s.skipped.includes('{font}') && s.skipped.includes('{chars}'));
  check(lang + ': loadError has {font} and {reason}', s.loadError.includes('{font}') && s.loadError.includes('{reason}'));
  check(lang + ': tooLong has {n} and {max}', s.tooLong.includes('{n}') && s.tooLong.includes('{max}'));
  check(lang + ': layouts for all 5 options', LAYOUTS.every((l) => typeof s.layouts[l] === 'string'));
  check(lang + ': formats for all copy options', ['plain', 'markdown', 'hash', 'slash', 'heredoc'].every((f) => typeof s.formats[f] === 'string'));
}
eq('fill', E.fill('{a} and {b}', { a: 1, b: 'x' }), '1 and x');

// ---------- PNG export while the page changes ----------
// Run the complete page script and its real FIGlet renderer against local font files.
// Canvas records the page's drawing calls; only the browser's toBlob completion is held.
// The PNG fixture is a valid opaque payload at this API boundary, not a substitute renderer.
// Actual browser font rasterization is covered by the browser acceptance flow.
// opts.clipboard: 'ok' (default), 'reject' (writeText rejects) or 'none' (no Clipboard API);
// opts.exec: the result of document.execCommand('copy') (default false).
function asciiExportPage(opts = {}) {
  const nodes = new Map(), pendingBlobs = [], downloads = [], copied = [], urls = new Map(), revoked = [], timers = new Map(), listeners = {};
  const tracks = [], execCopied = [];
  const heldFonts = new Map(), failedFonts = new Set();
  let sequence = 0;
  const document = { activeElement: null };
  class Element {
    constructor(id = '', tag = 'div') {
      Object.assign(this, { id, tagName: tag.toUpperCase(), value: '', checked: false, hidden: false, disabled: false, textContent: '', className: '', children: [], listeners: {}, style: {} });
    }
    select() { document.activeElement = this; }
    focus() { document.activeElement = this; }
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map((child) => child.textContent || '').join(''); }
    get firstChild() { return this.children[0] || null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type) { for (const fn of this.listeners[type] || []) fn.call(this, { target: this }); }
    click() { if (this.disabled) return; if (this.tagName === 'A') downloads.push({ name: this.download, blob: urls.get(this.href), url: this.href }); this.dispatch('click'); }
    appendChild(child) { this.children.push(child); return child; }
    remove() {}
    setAttribute(key, value) { (this.attributes ||= {})[key] = String(value); }
    scrollIntoView() {}
    querySelector(selector) {
      const match = (el) => selector.startsWith('[data-font=') ? el.attributes?.['data-font'] === /"([^"]+)"/.exec(selector)[1] : el.tagName === selector.toUpperCase();
      for (const child of this.children) { if (match(child)) return child; const found = child.querySelector?.(selector); if (found) return found; }
      return null;
    }
    contains(element) { return [...nodes.values()].includes(element); }
    querySelectorAll() { return [get('taa-input')]; }
  }
  class Canvas {
    constructor() {
      this.width = this.height = 0;
      this.drawn = [];
      this.context = {
        font: '', fillStyle: '', textBaseline: '',
        measureText: () => ({ width: 8 }),
        scale: (x, y) => this.drawn.push(['scale', x, y]),
        fillRect: (...rect) => this.drawn.push(['background', ...rect, this.context.fillStyle]),
        fillText: (text, x, y) => this.drawn.push(['glyph', text, x, y, this.context.fillStyle, this.context.font, this.context.textBaseline]),
      };
    }
    getContext() { return this.context; }
    toBlob(callback, mime) { pendingBlobs.push({ callback, mime, canvas: this, width: this.width, height: this.height, drawn: this.drawn.map((call) => [...call]) }); }
  }
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id); };
  Object.assign(document, {
    getElementById: get, body: new Element('body'),
    createElement: (tag) => tag === 'canvas' ? new Canvas() : new Element('', tag), createTextNode: (text) => ({ textContent: text }),
    querySelector: (selector) => selector === '.tool-widget' ? get('widget') : null,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    execCommand(cmd) {
      const el = document.activeElement;
      if (cmd !== 'copy' || !opts.exec) return false;
      execCopied.push(el && el.value);
      return true;
    },
  });
  const clipboardMode = opts.clipboard || 'ok';
  const navigator = clipboardMode === 'none' ? {}
    : { clipboard: { writeText: (text) => (clipboardMode === 'reject' ? Promise.reject(new Error('NotAllowedError')) : (copied.push(text), Promise.resolve())) } };
  for (const [id, value] of Object.entries({ input: 'Hello World', font: 'Standard', layout: 'default', width: '0', format: 'plain' })) get('taa-' + id).value = value;
  get('taa-trim').checked = true; get('taa-gallery').hidden = true;
  const sandbox = {
    console, Blob, document, S: { ...Object.fromEntries(Object.entries(STRINGS.en).filter(([key]) => key !== 'tips')), lang: 'en' }, FONT_NAMES,
    fetch(url) {
      const name = decodeURIComponent(url.slice('/figlet-fonts/'.length, -4));
      if (failedFonts.delete(name)) return Promise.resolve({ ok: false, status: 503 });
      const response = () => ({ ok: true, text: () => Promise.resolve(readFileSync(join(fontDir, name + '.flf'), 'utf8')) });
      if (heldFonts.has(name)) return new Promise((resolve) => heldFonts.set(name, () => resolve(response())));
      return Promise.resolve(response());
    },
    URL: { createObjectURL(blob) { const url = 'blob:ascii-' + (++sequence); urls.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); urls.delete(url); } },
    getComputedStyle: () => ({ fontFamily: 'monospace', color: '#111111', backgroundColor: '#ffffff' }),
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    navigator, ztPersist: { clear() {} }, _slug: 'text-to-ascii-art',
    trackTool: (slug, action) => tracks.push(slug + ':' + action),
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  const start = layout.indexOf("document.addEventListener('keydown'", layout.indexOf('// ── Keyboard shortcuts:'));
  vm.runInContext(layout.slice(start, layout.indexOf('// ── Copy button visual feedback', start)), ctx);
  const pageScript = /<script is:inline define:vars=[^>]*>([\s\S]*?)<\/script>/.exec(source);
  vm.runInContext(pageScript[1], ctx, { filename: 'TextToAsciiArtTool.astro', lineOffset: source.slice(0, pageScript.index).split('\n').length - 1 });
  function flush(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } }
  return {
    get, pendingBlobs, downloads, copied, revoked, tracks, execCopied, flush, body: document.body, doc: document,
    text(value) { get('taa-input').value = value; get('taa-input').dispatch('input'); flush(120); },
    font(value) { get('taa-font').value = value; get('taa-font').dispatch('change'); },
    clearShortcut() { document.activeElement = get('taa-input'); for (const fn of listeners.keydown || []) fn({ ctrlKey: true, key: 'l', preventDefault() {} }); flush(0); },
    failFont(name) { failedFonts.add(name); },
    holdFont(name) { heldFonts.set(name, null); }, releaseFont(name) { const done = heldFonts.get(name); heldFonts.delete(name); done(); },
    cleanup() { flush(1000); },
    release(job, blob) { try { job.callback(blob); return null; } catch (error) { return String(error); } },
  };
}
async function asciiPageSettles(predicate) {
  // Font responses are local resolved promises: drain their microtasks without running
  // the held toBlob callbacks or unrelated debounce/cleanup timers.
  for (let i = 0; i < 20 && !predicate(); i++) await Promise.resolve();
  return predicate();
}
const pngFixture = () => new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
const initialArt = E.formatOutput(E.renderFiglet(fonts.Standard, 'Hello World', {}), 'plain', true);
for (const mutation of ['text', 'font', 'empty', 'shortcut', 'invalid']) {
  const page = asciiExportPage();
  check('PNG ' + mutation + ': real initial render settles', await asciiPageSettles(() => page.get('taa-output').textContent === initialArt));
  page.get('taa-download-png').click();
  eq('PNG ' + mutation + ': one encode requested', page.pendingBlobs.length, 1);
  const job = page.pendingBlobs.shift(), image = pngFixture();
  eq('PNG ' + mutation + ': browser encoder receives PNG MIME', job.mime, 'image/png');
  eq('PNG ' + mutation + ': drawing uses the output at click time', job.drawn.filter((call) => call[0] === 'glyph').map((call) => call[1]).join(''), initialArt.replace(/[ \n]/g, ''));
  check('PNG ' + mutation + ': canvas size is nonzero', job.width > 0 && job.height > 0);
  if (mutation === 'text') {
    page.text('New Text');
    check('PNG text: new result finishes before old encoding', await asciiPageSettles(() => page.get('taa-output').textContent === E.formatOutput(E.renderFiglet(fonts.Standard, 'New Text', {}), 'plain', true)));
  } else if (mutation === 'font') {
    page.font('Big');
    check('PNG font: new font finishes before old encoding', await asciiPageSettles(() => page.get('taa-output').textContent === E.formatOutput(E.renderFiglet(fonts.Big, 'Hello World', {}), 'plain', true)));
  } else if (mutation === 'shortcut') page.clearShortcut();
  else page.text(mutation === 'empty' ? '' : 'X'.repeat(E.MAX_INPUT + 1));
  const outputAfterEdit = page.get('taa-output').textContent;
  eq('PNG ' + mutation + ': page edits do not redraw the captured canvas', job.canvas.drawn, job.drawn);
  eq('PNG ' + mutation + ': late completion does not throw', page.release(job, image), null);
  eq('PNG ' + mutation + ': download keeps the original text and font name', page.downloads.map((d) => d.name), ['hello-world-standard.png']);
  check('PNG ' + mutation + ': saves exactly the encoder payload', page.downloads[0]?.blob === image);
  eq('PNG ' + mutation + ': completion leaves the current output alone', page.get('taa-output').textContent, outputAfterEdit);
  page.cleanup();
  eq('PNG ' + mutation + ': download URL is revoked after settlement', page.revoked.length, 1);
}
{
  const page = asciiExportPage();
  await asciiPageSettles(() => page.get('taa-output').textContent === initialArt);
  page.get('taa-download-png').click(); const first = page.pendingBlobs.shift(), firstImage = pngFixture();
  page.text('Second');
  check('second PNG: changed text settles', await asciiPageSettles(() => page.get('taa-output').textContent === E.formatOutput(E.renderFiglet(fonts.Standard, 'Second', {}), 'plain', true)));
  page.get('taa-download-png').click(); const second = page.pendingBlobs.shift(), secondImage = pngFixture();
  eq('out-of-order PNG: second completes without error', page.release(second, secondImage), null);
  eq('out-of-order PNG: first completes without error', page.release(first, firstImage), null);
  eq('out-of-order PNG: each request keeps its filename', page.downloads.map((d) => d.name), ['second-standard.png', 'hello-world-standard.png']);
  check('out-of-order PNG: each download receives its own image', page.downloads[0]?.blob === secondImage && page.downloads[1]?.blob === firstImage);
  page.cleanup(); eq('out-of-order PNG: both URLs are released', page.revoked.length, 2);
}
{
  const page = asciiExportPage();
  await asciiPageSettles(() => page.get('taa-output').textContent === initialArt);
  page.get('taa-download-png').click();
  eq('PNG encoder failure does not throw', page.release(page.pendingBlobs.shift(), null), null);
  eq('PNG encoder failure downloads nothing', page.downloads.length, 0);
  eq('PNG encoder failure reports the existing error', page.get('taa-status').textContent, STRINGS.en.pngTooLarge);
  check('PNG encoder failure leaves export available', !page.get('taa-download-png').disabled);
  page.get('taa-download-png').click(); const image = pngFixture();
  eq('PNG retry settles', page.release(page.pendingBlobs.shift(), image), null);
  check('PNG retry downloads the new encoder result', page.downloads[0]?.blob === image);
  page.cleanup(); eq('PNG failure creates no URL; retry releases its URL', page.revoked.length, 1);
}
{
  const page = asciiExportPage();
  await asciiPageSettles(() => page.get('taa-output').textContent === initialArt);
  page.holdFont('Big'); page.font('Big');
  page.text('Newest'); page.font('Standard');
  const latest = E.formatOutput(E.renderFiglet(fonts.Standard, 'Newest', {}), 'plain', true);
  check('font race: newer cached font render completes', await asciiPageSettles(() => page.get('taa-output').textContent === latest));
  page.releaseFont('Big'); for (let i = 0; i < 20; i++) await Promise.resolve();
  eq('font race: late earlier font keeps generation guard', page.get('taa-output').textContent, latest);
}

// ---------- controls moved into the rail ----------
{
  const page = asciiExportPage();
  await asciiPageSettles(() => page.get('taa-output').textContent === initialArt);
  const lines = E.renderFiglet(fonts.Standard, 'Hello World', {});
  for (const format of ['plain', 'markdown', 'hash', 'slash', 'heredoc']) {
    page.get('taa-format').value = format;
    page.get('taa-copy').click();
    eq('rail copy format ' + format, page.copied.at(-1), E.formatOutput(lines, format, true));
  }
  page.get('taa-download-txt').click();
  eq('TXT stays plain regardless of Copy as format', await page.downloads.at(-1).blob.text(), initialArt + '\n');
  eq('TXT keeps the matching filename', page.downloads.at(-1).name, 'hello-world-standard.txt');
  page.get('taa-trim').checked = false; page.get('taa-trim').dispatch('change');
  eq('trim setting updates the preview', page.get('taa-output').textContent, E.formatOutput(lines, 'plain', false));
  page.get('taa-trim').checked = true; page.get('taa-trim').dispatch('change');
  page.get('taa-layout').value = 'full'; page.get('taa-layout').dispatch('change');
  check('spacing updates automatically from its folded control', await asciiPageSettles(() => page.get('taa-output').textContent === E.formatOutput(E.renderFiglet(fonts.Standard, 'Hello World', { layout: 'full' }), 'plain', true)));
  page.get('taa-width').value = '40'; page.get('taa-width').dispatch('change');
  check('width updates automatically from its folded control', await asciiPageSettles(() => page.get('taa-output').textContent === E.formatOutput(E.renderFiglet(fonts.Standard, 'Hello World', { layout: 'full', width: 40 }), 'plain', true)));
  page.get('taa-copy-command').click();
  eq('command copy reads the current settings', page.copied.at(-1), "figlet -f standard -W -w 40 'Hello World'");

  page.get('taa-preview-all').click();
  check('preview action reveals the gallery', !page.get('taa-gallery').hidden);
  eq('preview action exposes expanded state', page.get('taa-preview-all').attributes['aria-expanded'], 'true');
  eq('gallery creates all twelve font choices', page.get('taa-gallery').children.length, 12);
  check('all gallery previews use real loaded fonts', await asciiPageSettles(() => FONT_NAMES.every((name) => page.get('taa-gallery').querySelector('[data-font="' + name + '"]').querySelector('pre').textContent === E.formatOutput(E.renderFiglet(fonts[name], 'Hello World', { layout: 'full', width: 40 }), 'plain', true))));
  const mini = page.get('taa-gallery').querySelector('[data-font="Mini"]');
  mini.querySelector('button').click();
  check('Use Mini updates the main output', await asciiPageSettles(() => page.get('taa-output').textContent === E.formatOutput(E.renderFiglet(fonts.Mini, 'Hello World', { layout: 'full', width: 40 }), 'plain', true)));
  eq('Use Mini updates the font control', page.get('taa-font').value, 'Mini');
  check('current gallery font becomes disabled', mini.querySelector('button').disabled);
  page.get('taa-preview-all').click();
  check('preview action closes the gallery', page.get('taa-gallery').hidden);
  eq('closed gallery exposes collapsed state', page.get('taa-preview-all').attributes['aria-expanded'], 'false');
  page.get('taa-preview-all').click();
  eq('reopening the gallery reuses its twelve choices', page.get('taa-gallery').children.length, 12);
}
{
  const page = asciiExportPage();
  await asciiPageSettles(() => page.get('taa-output').textContent === initialArt);
  page.failFont('Big'); page.font('Big');
  check('font failure shows a retry action', await asciiPageSettles(() => page.get('taa-status').children.some((child) => child.tagName === 'BUTTON')));
  check('font failure clears the output and disables exports', !page.get('taa-output').textContent && page.get('taa-copy').disabled && page.get('taa-download-txt').disabled && page.get('taa-download-png').disabled);
  check('font failure retains its cause', page.get('taa-status').textContent.includes('HTTP 503'));
  page.get('taa-status').children.find((child) => child.tagName === 'BUTTON').click();
  check('retry loads the font and restores output', await asciiPageSettles(() => page.get('taa-output').textContent === E.formatOutput(E.renderFiglet(fonts.Big, 'Hello World', {}), 'plain', true)));
  eq('successful retry clears the error', page.get('taa-status').textContent, '');
  check('successful retry enables exports', !page.get('taa-download-png').disabled && !page.get('taa-copy').disabled);
}

// ---------- analytics: one event per committed action (S2-5, 2026-10-08) ----------
// Before: one `generate` event on the first input event of each page load, none afterwards and
// none for copy or download. Now, as in the other S2 tools: no event on load or for input
// events while typing; one `generate` per committed change (the text box's change event, a
// font / spacing / width / trim change, Use in the font preview), one `copy` per copy and one
// `download` per TXT or PNG download.
{
  const page = asciiExportPage();
  await asciiPageSettles(() => page.get('taa-output').textContent === initialArt);
  const n = (action) => page.tracks.filter((t) => t === 'text_to_ascii_art:' + action).length;
  eq('GA: no event on load', page.tracks.length, 0);
  page.text('H'); page.text('Hi'); page.text('Hi there');
  eq('GA: no event for input events while typing', page.tracks.length, 0);
  page.get('taa-input').dispatch('change');
  eq('GA: the text box change event sends one generate', n('generate'), 1);
  page.font('Big');
  page.get('taa-layout').value = 'full'; page.get('taa-layout').dispatch('change');
  page.get('taa-width').value = '80'; page.get('taa-width').dispatch('change');
  page.get('taa-trim').checked = false; page.get('taa-trim').dispatch('change');
  eq('GA: font, spacing, width and trim changes send one generate each', n('generate'), 5);
  await asciiPageSettles(() => !page.get('taa-copy').disabled && page.get('taa-output').textContent !== initialArt);
  page.get('taa-copy').click(); page.get('taa-copy-command').click();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  eq('GA: each copy sends one copy event', n('copy'), 2);
  page.get('taa-download-txt').click();
  eq('GA: TXT download sends one download event', n('download'), 1);
  page.get('taa-download-png').click();
  eq('GA: PNG sends nothing before the encoder finishes', n('download'), 1);
  page.release(page.pendingBlobs.shift(), pngFixture());
  eq('GA: PNG download sends one download event', n('download'), 2);
  page.get('taa-download-png').click();
  page.release(page.pendingBlobs.shift(), null);
  eq('GA: a failed PNG encode sends nothing', n('download'), 2);
  page.text('');
  page.get('taa-input').dispatch('change');
  eq('GA: committing an empty text box sends nothing', n('generate'), 5);
}

// ---------- copy fallback and failure ----------
// Same pattern as ColorPaletteGeneratorTool.astro copyText(): Clipboard API first; when it is
// missing or rejects, a hidden textarea and document.execCommand('copy'); when both fail, the
// status line shows copyFailed.
{
  const lines = E.renderFiglet(fonts.Standard, 'Hello World', {});
  const plain = E.formatOutput(lines, 'plain', true);
  for (const mode of ['reject', 'none']) {
    const page = asciiExportPage({ clipboard: mode, exec: true });
    await asciiPageSettles(() => page.get('taa-output').textContent === initialArt);
    page.get('taa-copy').click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    eq('copy ' + mode + ' + execCommand: the fallback copies the art', page.execCopied, [plain]);
    eq('copy ' + mode + ' + execCommand: the button says copied', page.get('taa-copy').textContent, STRINGS.en.copied);
    eq('copy ' + mode + ' + execCommand: no error in the status line', page.get('taa-status').textContent, '');
    eq('copy ' + mode + ' + execCommand: the helper textarea is removed', page.body.children.filter((c) => c.tagName === 'TEXTAREA').length, 0);
    check('copy ' + mode + ' + execCommand: focus returns to the Copy button', page.doc.activeElement === page.get('taa-copy'));
    page.get('taa-copy-command').click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    eq('copy command ' + mode + ' + execCommand: the fallback copies the command', page.execCopied[1], "figlet -f standard 'Hello World'");
  }
  for (const mode of ['reject', 'none']) {
    const page = asciiExportPage({ clipboard: mode, exec: false });
    await asciiPageSettles(() => page.get('taa-output').textContent === initialArt);
    page.get('taa-copy').click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    eq('copy ' + mode + ' + no execCommand: the status line says copying was blocked', page.get('taa-status').textContent, STRINGS.en.copyFailed);
    check('copy ' + mode + ' + no execCommand: the status is an error', /\berror\b/.test(page.get('taa-status').className));
    eq('copy ' + mode + ' + no execCommand: the button keeps its label', page.get('taa-copy').textContent === STRINGS.en.copied, false);
  }
}

// ---------- v2 page layout ----------
{
  const template = source.slice(source.indexOf('\n---\n') + 5, source.indexOf('<script is:inline'));
  const css = source.slice(source.indexOf('<style>'));
  check('generate layout registered', /'text-to-ascii-art':\s*'generate'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
  check('tool root directly contains body and shared rail', /^<div class="taa-wrap">\s*<div class="taa-body">\s*<div class="taa-rail zt-rail">/.test(template));
  check('root is a flex column with zero minimum height', /\.taa-wrap\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*min-height:\s*0/.test(css));
  check('desktop rail stays between 270 and 320px', /\.taa-body\s*\{[^}]*grid-template-columns:\s*clamp\(270px,\s*26vw,\s*320px\)\s*minmax\(0,\s*1fr\)/.test(css));
  check('main input and all export actions precede folded options', ['taa-input', 'taa-copy', 'taa-download-txt', 'taa-download-png'].every((id) => template.indexOf('id="' + id + '"') < template.indexOf('<details')));
  check('secondary options and command start collapsed', [...template.matchAll(/<details\b[^>]*>/g)].length === 2 && !/<details\b[^>]*\sopen(?:\s|>)/.test(template));
  check('font comparison remains an explicit action', /id="taa-preview-all"[^>]*aria-controls="taa-gallery"/.test(template));
  check('skipped characters stay directly below output', /<pre id="taa-output"[^>]*><\/pre>\s*<p id="taa-skipped"/.test(template));
  check('output fills the available height and scrolls internally', /\.taa-output\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0[^}]*overflow:\s*auto/.test(css));
  check('gallery has bounded flex height and internal scrolling', /\.taa-gallery\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0[^}]*overflow:\s*auto/.test(css));
  check('empty status keeps its reserved height', /\.taa-status\s*\{[^}]*height:\s*5rem/.test(css) && !/\.taa-status:empty/.test(css));
  check('mobile results precede secondary settings', /\.taa-preview \{ order: 3; \}/.test(css) && /\.taa-details \{ order: 4; \}/.test(css));
  check('860px stacks the layout and 640px adjusts phone details', /@media \(max-width: 860px\)/.test(css) && /@media \(max-width: 640px\)/.test(css));
  check('mobile empty output hides only when no skipped-character warning exists', /\.taa-output-box:has\(\.taa-output:empty\):has\(\.taa-note\[hidden\]\)\s*\{\s*display:\s*none/.test(css));
  check('tips do not enter serialized client strings', /const \{ tips: TIPS, \.\.\.CLIENT_T \} = T/.test(source) && /const L = \{ \.\.\.CLIENT_T, lang \}/.test(source) && /define:vars=\{\{ S: L, FONT_NAMES \}\}/.test(source));
  check('no runtime i18n rewriting', !source.includes('data-i18n'));
  const tips = ['input', 'font', 'layout', 'width', 'format', 'trim', 'export', 'command'];
  eq('eight distinct control tips', [...template.matchAll(/<Toggletip id="taa-tip-([^" ]+)"/g)].map((m) => m[1]).sort(), [...tips].sort());
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    eq(lang + ' eight matching tip keys', Object.keys(STRINGS[lang].tips).sort(), [...tips].sort());
    check(lang + ' each tip has text', tips.every((key) => typeof STRINGS[lang].tips[key] === 'string' && STRINGS[lang].tips[key].length > 20));
    check(lang + ' output has localized empty text', !!STRINGS[lang].previewEmpty && template.includes('data-empty={T.previewEmpty}'));
    const mdx = readFileSync(join(root, 'src/content/tools/text-to-ascii-art', lang + '.mdx'), 'utf8');
    const steps = (/^steps:\n([\s\S]*?)(?=^\S)/m.exec(mdx)?.[1].match(/^  - .+$/gm) || []).map((line) => JSON.parse(line.slice(4)));
    eq(lang + ' six usage steps', steps.length, 6);
    check(lang + ' steps fit content limits', steps.every((step) => step.length <= 280) && steps.join('').length <= 1200);
    check(lang + ' steps identify folded options and command', steps.some((step) => step.includes(STRINGS[lang].moreOptions)) && steps.some((step) => step.includes(STRINGS[lang].commandDetails)));
    check(lang + ' HowTo removed', !/^## (?:How to use|使用步骤|使い方|사용 방법)$/m.test(mdx));
    check(lang + ' Limits retained', /^## (?:Limits|限制|制限事項|제한 사항)$/m.test(mdx));
  }
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
