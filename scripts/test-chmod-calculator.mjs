// Chmod Calculator — symbolic string, numeric string and symbolic chmod command
//
// Read:  src/components/tools/ChmodCalculatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers);
//        src/content/blog/chmod-calculator-guide/{en,ja}.mdx (`chmod-check` / `chmod-ls` /
//        `chmod-umask` / `chmod-gnu-dir` annotations, see the guide section below)
// Write: a temporary directory under os.tmpdir() (removed at the end); stdout (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: ls-style strings (s/S, t/T), numeric strings with and without the special digit, and the
// "Symbolic cmd" output. Before the fix that command ignored setuid, setgid and the sticky bit
// (4755 gave chmod u=rwx,g=rx,o=rx). It now writes s after u= / g= and a separate +t; o+t is
// ignored by BSD/macOS chmod, +t works there and in GNU coreutils. The commands are run with the
// system chmod on a directory that starts at mode 00000 and the resulting mode (fs.statSync) must
// equal the numeric value, for every combination of special bits with 12 base modes. Directories
// are used because BSD lets only root set the sticky bit on a regular file. Skipped on Windows.
//
// Run: node scripts/test-chmod-calculator.mjs

import { readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ChmodCalculatorTool.astro'), 'utf8');
const a = source.indexOf('/* ── engine:start ── */');
const b = source.indexOf('/* ── engine:end ── */');
if (a < 0 || b <= a) { console.error('FAIL: engine block not found'); process.exit(1); }
const E = new Function(source.slice(a, b) + '\nreturn { buildSymbolic, buildNumericStr, buildSymCmd, stripLsDecorations };')();

let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + ' — got ' + JSON.stringify(got) + ', expected ' + JSON.stringify(want)); }
}
const digitsOf = (mode) => [(mode >> 6) & 7, (mode >> 3) & 7, mode & 7];

const table = [
  // mode, symbolic, numeric, symbolic command
  [0o755, 'rwxr-xr-x', '755', 'chmod u=rwx,g=rx,o=rx filename'],
  [0o644, 'rw-r--r--', '644', 'chmod u=rw,g=r,o=r filename'],
  [0o600, 'rw-------', '600', 'chmod u=rw,g=,o= filename'],
  [0o4755, 'rwsr-xr-x', '4755', 'chmod u=rwxs,g=rx,o=rx filename'],
  [0o2775, 'rwxrwsr-x', '2775', 'chmod u=rwx,g=rwxs,o=rx filename'],
  [0o1777, 'rwxrwxrwt', '1777', 'chmod u=rwx,g=rwx,o=rwx,+t filename'],
  [0o4644, 'rwSr--r--', '4644', 'chmod u=rws,g=r,o=r filename'],
  [0o1770, 'rwxrwx--T', '1770', 'chmod u=rwx,g=rwx,o=,+t filename'],
  [0o6755, 'rwsr-sr-x', '6755', 'chmod u=rwxs,g=rxs,o=rx filename'],
];
for (const [mode, sym, num, cmd] of table) {
  const d = digitsOf(mode), sp = mode >> 9;
  eq(num + ' symbolic', E.buildSymbolic(d, sp), sym);
  eq(num + ' numeric', E.buildNumericStr(d, sp), num);
  eq(num + ' symbolic command', E.buildSymCmd(d, sp), cmd);
}

// ls -l strings (the field had maxlength 9, so a pasted "-rwxr-xr-x" was cut to "-rwxr-xr-" and rejected)
eq('ls -l regular file', E.stripLsDecorations('-rwxr-xr-x'), 'rwxr-xr-x');
eq('ls -l directory with sticky bit', E.stripLsDecorations('drwxrwxrwt'), 'rwxrwxrwt');
eq('macOS extended attributes marker', E.stripLsDecorations('-rw-r--r--@'), 'rw-r--r--');
eq('ACL marker', E.stripLsDecorations('drwxr-xr-x+'), 'rwxr-xr-x');
eq('SELinux marker', E.stripLsDecorations('-rw-r--r--.'), 'rw-r--r--');
eq('plain 9 characters unchanged', E.stripLsDecorations('rwsr-xr-x'), 'rwsr-xr-x');
eq('unknown type letter unchanged', E.stripLsDecorations('xrwxr-xr-x'), 'xrwxr-xr-x');
check: {
  const m = source.match(/id="chmod-symbolic"[^>]*maxlength="(\d+)"/);
  eq('symbolic field accepts 11 characters', m && m[1], '11');
}

if (process.platform === 'win32') {
  console.log('SKIP system chmod (Windows)');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'chmod-test-'));
  const target = join(dir, 'd');
  execFileSync('mkdir', [target]);
  try {
    const bases = [0o000, 0o644, 0o755, 0o700, 0o750, 0o775, 0o777, 0o600, 0o640, 0o711, 0o444, 0o070];
    for (const base of bases) {
      for (let sp = 0; sp < 8; sp++) {
        const mode = (sp << 9) | base;
        execFileSync('chmod', ['00000', target]);
        const cmd = E.buildSymCmd(digitsOf(mode), sp).replace(/^chmod /, '').replace(/ filename$/, '');
        execFileSync('chmod', [cmd, target]);
        const got = statSync(target).mode & 0o7777;
        eq(`system chmod ${cmd} gives ${mode.toString(8).padStart(4, '0')}`, got.toString(8), mode.toString(8));
      }
    }
  } finally {
    execFileSync('chmod', ['700', target]);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── chmod-calculator-guide (en, ja) ────────────────────────────────────────────────────
// `chmod-check` annotations: for the octal mode, the calculator's mode string, symbolic command
// and find command equal the listed values, and the mode string appears in the guide text.
// `chmod-ls`: stripLsDecorations turns the ls -l string into the listed 9 characters.
// `chmod-umask`: a file created with 666 and a directory with 777 under that umask get the
// listed modes. `chmod-gnu-dir`: on GNU coreutils (Linux CI), each command applied to a 2775
// directory leaves the listed mode; on macOS the same commands are checked against the BSD
// column of the table (setgid cleared, `=755` rejected). The other system results quoted in
// the guides (+x under a umask, capital X, find -perm forms) are rerun on the system chmod/find.
const findExpr = "'find . -type f -perm ' + (special > 0 ? numeric : ('0' + numeric))";
eq('find command built as in the guides', source.includes(findExpr), true);
const findFor = (num, sp) => 'find . -type f -perm ' + (sp > 0 ? num : '0' + num);
const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
let gnuDir = null;
for (const lang of ['en', 'ja']) {
  const guide = readFileSync(join(root, `src/content/blog/chmod-calculator-guide/${lang}.mdx`), 'utf8');
  const body = stripComments(guide);
  const checks = [...guide.matchAll(/\{\/\* chmod-check: (\{.*?\}) \*\/\}/g)].map((m) => JSON.parse(m[1]));
  eq(lang + ' guide has at least 8 chmod-check annotations', checks.length >= 8, true);
  for (const c of checks) {
    const mode = parseInt(c.mode, 8);
    const d = digitsOf(mode), sp = mode >> 9;
    const num = E.buildNumericStr(d, sp);
    eq(`${lang} guide ${c.mode} numeric`, num, c.mode);
    eq(`${lang} guide ${c.mode} symbolic`, E.buildSymbolic(d, sp), c.symbolic);
    eq(`${lang} guide ${c.mode} symbolic command`, E.buildSymCmd(d, sp), c.cmd);
    eq(`${lang} guide ${c.mode} find command`, findFor(num, sp), c.find);
    eq(`${lang} guide shows ${c.symbolic}`, body.includes(c.symbolic), true);
  }
  for (const m of guide.matchAll(/\{\/\* chmod-ls: (\{.*?\}) \*\/\}/g)) {
    const c = JSON.parse(m[1]);
    eq(`${lang} guide ls -l ${c.in}`, E.stripLsDecorations(c.in), c.out);
    eq(`${lang} guide shows ${c.in}`, body.includes(c.in), true);
  }
  const umasks = [...guide.matchAll(/\{\/\* chmod-umask: (\{.*?\}) \*\/\}/g)].map((m) => JSON.parse(m[1]));
  eq(lang + ' guide has umask annotations', umasks.length >= 3, true);
  for (const c of umasks) {
    const u = parseInt(c.umask, 8);
    eq(`${lang} umask ${c.umask} file`, (0o666 & ~u).toString(8), c.file);
    eq(`${lang} umask ${c.umask} directory`, (0o777 & ~u).toString(8), c.dir);
  }
  const g = guide.match(/\{\/\* chmod-gnu-dir: (\{.*?\}) \*\/\}/);
  eq(lang + ' guide has the GNU directory table', !!g, true);
  if (g) {
    const parsed = JSON.parse(g[1]);
    if (gnuDir) eq(lang + ' GNU directory table matches en', JSON.stringify(parsed), JSON.stringify(gnuDir));
    gnuDir = parsed;
    for (const [cmd, want] of Object.entries(parsed)) {
      eq(`${lang} table row chmod ${cmd} -> ${want}`, new RegExp('`chmod ' + cmd + ' d` \\| `' + want + '`').test(body), true);
    }
  }
}

if (process.platform !== 'win32') {
  const sh = (script, cwd) => execFileSync('sh', ['-c', script], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let version = '';
  try { version = execFileSync('chmod', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* BSD chmod has no --version */ }
  const isGnu = /GNU coreutils/.test(version);
  const isDarwin = process.platform === 'darwin';
  const modeOf = (p) => (statSync(p).mode & 0o7777).toString(8);
  const dir = mkdtempSync(join(tmpdir(), 'chmod-guide-'));
  try {
    // +x without a class follows the umask; a+x does not (POSIX chmod)
    sh('touch g', dir);
    sh('umask 077; chmod 644 g; chmod +x g', dir); eq('umask 077: chmod +x on 644 gives 744', modeOf(join(dir, 'g')), '744');
    sh('umask 077; chmod 644 g; chmod a+x g', dir); eq('umask 077: chmod a+x on 644 gives 755', modeOf(join(dir, 'g')), '755');
    sh('umask 022; chmod 600 g; chmod +w g', dir); eq('umask 022: chmod +w on 600 gives 600', modeOf(join(dir, 'g')), '600');
    sh('umask 022; chmod 600 g; chmod +x g', dir); eq('umask 022: chmod +x on 600 gives 711', modeOf(join(dir, 'g')), '711');
    // capital X
    sh('mkdir -p X/sub && touch X/plain X/sub/run && chmod 600 X/plain && chmod 700 X/sub/run X/sub X && chmod -R u=rwX,go=rX X', dir);
    eq('capital X: directory 755', modeOf(join(dir, 'X')), '755');
    eq('capital X: plain file 644', modeOf(join(dir, 'X/plain')), '644');
    eq('capital X: executable file 755', modeOf(join(dir, 'X/sub/run')), '755');
    // find -perm forms (the setuid file needs no special rights: we own it)
    sh('mkdir fp && cd fp && touch a b c d && chmod 755 a && chmod 775 b && chmod 644 c && chmod 4755 d', dir);
    const fp = join(dir, 'fp');
    const list = (args) => sh(`find . -type f ${args} | sort | tr '\\n' ' '`, fp);
    eq('find -perm 0755', list('-perm 0755'), './a');
    eq('find -perm -0755', list('-perm -0755'), './a ./b ./d');
    eq('find -perm -4000', list('-perm -4000'), './d');
    if (isGnu || !isDarwin) eq('find -perm /022 (GNU)', list('-perm /022'), './b');
    if (isDarwin) eq('find -perm +022 (macOS)', list('-perm +022'), './b');
    // setgid on a directory: GNU keeps it for short numeric and absolute symbolic modes
    for (const [cmd, gnuWant] of Object.entries(gnuDir || {})) {
      sh('rm -rf sd && mkdir sd && chmod 2775 sd', dir);
      let ok = true;
      try { execFileSync('chmod', [cmd, join(dir, 'sd')], { stdio: 'ignore' }); } catch { ok = false; }
      if (isGnu) eq(`GNU chmod ${cmd} on 2775 dir gives ${gnuWant}`, modeOf(join(dir, 'sd')), gnuWant);
      else if (isDarwin) {
        if (cmd === '=755') eq('macOS rejects chmod =755', ok, false);
        else eq(`macOS chmod ${cmd} on 2775 dir gives 755`, modeOf(join(dir, 'sd')), '755');
      }
    }
    sh('rm -rf sd && mkdir sd && chmod 2775 sd && chmod g-s sd', dir);
    eq('chmod g-s on 2775 dir gives 775', modeOf(join(dir, 'sd')), '775');
    sh('touch su && chmod 4755 su && chmod 755 su', dir);
    eq('chmod 755 clears setuid on a regular file', modeOf(join(dir, 'su')), '755');
    if (isDarwin) {
      sh('mkdir ot && chmod 755 ot && chmod o+t ot', dir);
      eq('macOS ignores chmod o+t on a directory', modeOf(join(dir, 'ot')), '755');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
