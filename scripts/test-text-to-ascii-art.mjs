// Text to ASCII Art — output matches figlet 2.2.5 character for character
//
// Read:  src/components/tools/TextToAsciiArtTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers, the frontmatter STRINGS table and FONT_NAMES),
//        public/figlet-fonts/*.flf (the fonts the page loads),
//        scripts/test-text-to-ascii-art.fixtures.json (figlet 2.2.5 output hashes),
//        src/content/tools/text-to-ascii-art/{en,zh,ja,ko}.mdx (annotated examples), package.json
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
  check('12 fonts × ' + E.MAX_INPUT + ' characters without a width limit in under 1.5 s (' + Math.round(ms) + ' ms)', ms < 1500);
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

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
