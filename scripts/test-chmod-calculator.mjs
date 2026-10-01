// Chmod Calculator — symbolic string, numeric string and symbolic chmod command
//
// Read:  src/components/tools/ChmodCalculatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers)
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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
