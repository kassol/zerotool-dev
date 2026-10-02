// Regex cheat sheet (blog, en / ja / ko) — every quoted match result, rerun in four engines
//
// Read:  src/content/blog/regex-cheat-sheet/{en,ja,ko}.mdx, src/components/tools/RegexTesterTool.astro
// Write: stdout only (test results); temporary files under the OS temp directory
// Exit:  0 if all PASS, 1 if any FAIL
//
// Annotation {/* rx: {"p":"…","f":"…","s":"…","js":[…],"py":[…],"go":[…],"pcre":[…]} */}: the
// pattern p with JavaScript-style flags f is run on subject s; each listed engine must return the
// listed whole-match strings in order, or the string "error" if it must refuse the pattern.
// js runs in this process (the same loop as the Regex Tester, which also checks every annotation
// whose flags are within g/i/m/s, the only flags the tool has); "jsMin" skips js on older Node.
// py runs python3 `re` (finditer, group 0), go runs `regexp.FindAllString` via `go run`, pcre
// runs `pcre2test` with the utf modifier. A missing python3, go or pcre2test is a SKIP.
// Code blocks preceded by {/* rx-run: {"lang":"node|python","expect":"…"} */} are run and their
// stdout must equal expect; "jsMin" applies to node blocks. The pattern of each annotation must
// appear in the page (a `|` may be written as `\|` inside tables).
//
// Run: node scripts/test-regex-cheat-sheet.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const nodeMajor = Number(process.versions.node.split('.')[0]);
let passes = 0, failures = 0, skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + (detail !== undefined ? '\n  ' + detail : '')); }
}
function skip(name, why) { skips++; console.log('SKIP ' + name + ' (' + why + ')'); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function has(cmd, args) { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return !r.error && r.status === 0; }
// Engine behaviour (Unicode tables in particular) changes between releases, so each engine is only
// compared at the version the expected results were recorded with; other versions are a SKIP.
function versionOf(cmd, args) { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return r.error || r.status !== 0 ? null : (r.stdout + r.stderr); }
const PINNED = {
  python3: [['--version'], /^Python 3\.12\./],
  go: [['version'], /^go version go1\.27[.\s]/],
  pcre2test: [['-version'], /^PCRE2 version 10\.49 /],
};
function hasPinned(cmd) { const out = versionOf(cmd, PINNED[cmd][0]); return !!out && PINNED[cmd][1].test(out.trim()); }

// Same loop as run() in RegexTesterTool.astro: always global, zero-length matches advance lastIndex.
function tester(pattern, flags, text) {
  const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}
function js(p, f, s) {
  try { const re = new RegExp(p, f.includes('g') ? f : f + 'g'); return [...s.matchAll(re)].map((m) => m[0]); }
  catch { return 'error'; }
}
const toolSrc = readFileSync(join(root, 'src/components/tools/RegexTesterTool.astro'), 'utf8');
const toolFlags = [...toolSrc.matchAll(/type="checkbox" value="([a-z])"/g)].map((m) => m[1]).join('');
check('Regex Tester offers exactly the flags g, i, m, s', toolFlags === 'gims', toolFlags);
check('Regex Tester loop forces the g flag', toolSrc.includes("flags.includes('g') ? flags : flags + 'g'"));

const langs = ['en', 'ja', 'ko'];
const cases = [];
const runs = [];
for (const lang of langs) {
  const rel = `src/content/blog/regex-cheat-sheet/${lang}.mdx`;
  const text = readFileSync(join(root, rel), 'utf8');
  for (const m of text.matchAll(/\{\/\* rx: (\{.*?\}) \*\/\}/g)) {
    let spec;
    try { spec = JSON.parse(m[1]); } catch { check(rel + ' annotation is JSON', false, m[1].slice(0, 120)); continue; }
    cases.push({ rel, ...spec });
    const p = spec.p;
    check(`${rel} quotes the pattern ${p.slice(0, 40)}`, text.includes(p) || text.includes(p.replace(/\|/g, '\\|')));
  }
  for (const m of text.matchAll(/\{\/\* rx-run: (\{.*?\}) \*\/\}\s*```([a-z]*)\n([\s\S]*?)```/g)) {
    runs.push({ rel, spec: JSON.parse(m[1]), code: m[3] });
  }
  const count = cases.filter((c) => c.rel === rel).length;
  check(`${rel} has rx annotations`, count >= 15, count);
  const h2 = [...text.matchAll(/^## (.+)$/gm)].map((x) => x[1]);
  check(`${rel} has no template headings`, !h2.some((h) => /^what (is|are)\b|online|\bin (code|javascript|python)\b|summary|conclusion/i.test(h)), h2.join(' | '));
  check(`${rel} is indexable`, !/^noindex:\s*true/m.test(text));
  if (lang === 'ja') check('ja uses the local term 正規表現', (text.match(/正規表現/g) || []).length >= 10);
  if (lang === 'ko') check('ko uses the local term 정규표현식', (text.match(/정규표현식/g) || []).length >= 5);
}
const h2counts = langs.concat('zh').map((l) => (readFileSync(join(root, `src/content/blog/regex-cheat-sheet/${l}.mdx`), 'utf8').match(/^## /gm) || []).length);
check('H2 counts differ between en / ja / ko / zh', new Set(h2counts).size === 4, h2counts.join(','));

// JavaScript and the Regex Tester
for (const c of cases) {
  const name = `${c.rel} /${c.p.slice(0, 50)}/${c.f}`;
  if (c.js !== undefined) {
    if (c.jsMin && nodeMajor < c.jsMin) skip(name + ' js', 'needs Node ' + c.jsMin);
    else check(name + ' js', same(js(c.p, c.f, c.s), c.js), JSON.stringify(js(c.p, c.f, c.s)));
  }
  if (Array.isArray(c.js) && /^[gims]*$/.test(c.f) && !(c.jsMin && nodeMajor < c.jsMin)) {
    check(name + ' Regex Tester', same(tester(c.p, c.f, c.s), c.js), JSON.stringify(tester(c.p, c.f, c.s)));
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'regex-cheat-sheet-'));
try {
  // Python re
  const pyCases = cases.filter((c) => c.py !== undefined);
  if (!hasPinned('python3')) skip('python re (' + pyCases.length + ' cases)', 'python3 3.12 not found');
  else {
    const prog = `import re, json, sys
F = {'i': re.I, 'm': re.M, 's': re.S, 'x': re.X}
out = []
for p, f, s in json.load(sys.stdin):
    fl = 0
    for ch in f:
        fl |= F.get(ch, 0)
    try:
        out.append([m.group(0) for m in re.finditer(p, s, fl)])
    except re.error:
        out.append('error')
print(json.dumps(out))`;
    const res = JSON.parse(execFileSync('python3', ['-c', prog], { input: JSON.stringify(pyCases.map((c) => [c.p, c.f, c.s])), encoding: 'utf8' }));
    pyCases.forEach((c, i) => check(`${c.rel} /${c.p.slice(0, 50)}/${c.f} python`, same(res[i], c.py), JSON.stringify(res[i])));
  }

  // Go regexp (RE2 syntax); i/m/s become a (?ims) prefix
  const goCases = cases.filter((c) => c.go !== undefined);
  if (!hasPinned('go')) skip('go regexp (' + goCases.length + ' cases)', 'go 1.27 not found');
  else {
    const prog = `package main
import ("encoding/json"; "fmt"; "os"; "regexp")
func main() {
	var cases [][3]string
	json.NewDecoder(os.Stdin).Decode(&cases)
	out := []interface{}{}
	for _, c := range cases {
		p, f := c[0], ""
		for _, ch := range c[1] { if ch == 'i' || ch == 'm' || ch == 's' { f += string(ch) } }
		if f != "" { p = "(?" + f + ")" + p }
		re, err := regexp.Compile(p)
		if err != nil { out = append(out, "error"); continue }
		m := re.FindAllString(c[2], -1)
		if m == nil { m = []string{} }
		out = append(out, m)
	}
	b, _ := json.Marshal(out)
	fmt.Println(string(b))
}`;
    writeFileSync(join(tmp, 'main.go'), prog);
    const res = JSON.parse(execFileSync('go', ['run', join(tmp, 'main.go')], { input: JSON.stringify(goCases.map((c) => [c.p, c.f, c.s])), encoding: 'utf8', env: { ...process.env, GO111MODULE: 'off' } }));
    goCases.forEach((c, i) => check(`${c.rel} /${c.p.slice(0, 50)}/${c.f} go`, same(res[i], c.go), JSON.stringify(res[i])));
  }

  // PCRE2 via pcre2test
  const pcCases = cases.filter((c) => c.pcre !== undefined);
  if (!hasPinned('pcre2test')) skip('pcre2 (' + pcCases.length + ' cases)', 'pcre2test 10.49 not found');
  else {
    // Subject lines: everything but ASCII letters and digits as \x{…}, so pcre2test keeps
    // trailing spaces and does not read backslashes.
    const enc = (s) => [...s].map((ch) => (/[A-Za-z0-9]/.test(ch) ? ch : '\\x{' + ch.codePointAt(0).toString(16) + '}')).join('');
    let input = '';
    for (const c of pcCases) {
      const delim = [...'/!#%&,;~`'].find((d) => !c.p.includes(d));
      const mods = ['g', 'utf'];
      for (const ch of c.f) if ('ims'.includes(ch)) mods.push({ i: 'caseless', m: 'multiline', s: 'dotall' }[ch]);
      input += `${delim}${c.p}${delim}${mods.join(',')}\n${enc(c.s)}\n\n`;
    }
    writeFileSync(join(tmp, 'p.in'), input);
    const r = spawnSync('pcre2test', ['-q', join(tmp, 'p.in')], { encoding: 'utf8' });
    const blocks = (r.stdout || '').split(/\n\n/).filter((b) => b.trim());
    pcCases.forEach((c, i) => {
      const b = blocks[i] || '';
      const got = /Failed: error/.test(b) ? 'error'
        : [...b.matchAll(/^ 0: (.*)$/gm)].map((x) => x[1].replace(/\\x\{([0-9a-f]+)\}|\\x([0-9a-f]{2})/g, (_, h1, h2) => String.fromCodePoint(parseInt(h1 || h2, 16))));
      check(`${c.rel} /${c.p.slice(0, 50)}/${c.f} pcre2`, same(got, c.pcre), JSON.stringify(got) + ' ' + b.slice(0, 160));
    });
  }

  // Runnable code blocks
  runs.forEach((r, i) => {
    const name = `${r.rel} ${r.spec.lang} block ${i + 1}`;
    if (r.spec.lang === 'node') {
      if (r.spec.jsMin && nodeMajor < r.spec.jsMin) { skip(name, 'needs Node ' + r.spec.jsMin); return; }
      const file = join(tmp, `b${i}.mjs`);
      writeFileSync(file, r.code);
      const out = spawnSync(process.execPath, [file], { encoding: 'utf8' });
      check(name, out.status === 0 && out.stdout.trimEnd() === r.spec.expect, out.stdout + out.stderr);
    } else if (r.spec.lang === 'python') {
      if (!hasPinned('python3')) { skip(name, 'python3 3.12 not found'); return; }
      const out = spawnSync('python3', ['-c', r.code], { encoding: 'utf8' });
      check(name, out.status === 0 && out.stdout.trimEnd() === r.spec.expect, out.stdout + out.stderr);
    }
  });
  check('runnable blocks found', runs.length >= 5, runs.length);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${failures} failed, ${skips} skipped`);
process.exit(failures ? 1 : 0);
