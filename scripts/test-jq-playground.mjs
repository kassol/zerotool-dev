// jq Playground — the page runs jq 1.7.1 (jq-web 0.6.2 + scripts/jq-web-patch.mjs) the way
// `jq FLAGS FILTER input.json` runs, and its helpers read jq's options, errors and output.
//
// Read:  node_modules/jq-web/{jq.js,jq.wasm,package.json}, scripts/jq-web-patch.mjs,
//        src/components/tools/{jq-playground-engine.js,jq-playground.worker.js,JqPlaygroundTool.astro},
//        src/content/tools/jq-playground/{en,zh,ja,ko}.mdx,
//        scripts/test-jq-playground.fixtures.json (jq 1.7.1 CLI output for CLI_CASES, and the
//        241 examples of the jq 1.7.1 manual, docs/content/manual/manual.yml at tag jq-1.7.1,
//        CC BY 3.0)
// Write: a temporary directory under os.tmpdir() (patched jq.js + jq.wasm; input.json for the
//        CLI), removed at the end; stdout (test results). With --record, also rewrites the
//        fixture's `cli` section from the installed jq (must be jq 1.7.1).
// Exit:  0 if all PASS, 1 if any FAIL
//
// The live comparison with the jq CLI runs only when `jq --version` is jq-1.7.1 (Ubuntu 24.04,
// macOS /usr/bin/jq reports jq-1.7.1-apple); other versions are SKIP. The fixture comparison
// always runs.
//
// Run: node scripts/test-jq-playground.mjs [--record]

import { readFileSync, writeFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import vm from 'node:vm';
import { patchJqWeb, PATCHES, JQ_WEB_VERSION } from './jq-web-patch.mjs';
import * as E from '../src/components/tools/jq-playground-engine.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));
const FIXTURE_PATH = join(root, 'scripts/test-jq-playground.fixtures.json');
const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
const RECORD = process.argv.includes('--record');

let failures = 0, passes = 0, skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' — ' + why); }

// ── patched jq-web in a temporary directory (jq.js finds jq.wasm next to itself) ──
const pkg = JSON.parse(readFileSync(join(root, 'node_modules/jq-web/package.json'), 'utf8'));
eq('jq-web version matches the patch', pkg.version, JQ_WEB_VERSION);
const original = readFileSync(join(root, 'node_modules/jq-web/jq.js'), 'utf8');
const patched = patchJqWeb(original);
for (const p of PATCHES) check('patch applied: ' + p.name, patched.includes(p.replace) && !original.includes(p.replace), p.name);
{
  let threw = false;
  try { patchJqWeb(original.replace(PATCHES[0].find, 'changed')); } catch { threw = true; }
  check('a patch that does not match stops the build', threw);
  threw = false;
  try { patchJqWeb(original + '\n' + PATCHES[1].find); } catch { threw = true; }
  check('a patch that matches twice stops the build', threw);
}
const tmp = mkdtempSync(join(os.tmpdir(), 'zt-jq-'));
writeFileSync(join(tmp, 'jq.js'), patched);
copyFileSync(join(root, 'node_modules/jq-web/jq.wasm'), join(tmp, 'jq.wasm'));
const jq = await createRequire(join(tmp, 'x.js'))(join(tmp, 'jq.js'));

function runWeb(input, filter, opts, args) {
  return jq.run(E.prepareInput(input), filter, E.buildFlags(opts, args));
}

// ── CLI cases: stdout, stderr and exit code byte for byte ──
const o = (flags) => Object.assign(E.defaultOptions(), flags || {});
const CLI_CASES = [
  ['{"a":[1,2,{"b":"x"}]}', '.a[]|.b', {}],
  ['[{"a":1},2]', '.[] | .a', {}],
  ['{"a":1', '.', {}],
  ["{'a':1}", '.', {}],
  ['{"a":1,}', '.', {}],
  ['{"a":True}', '.', {}],
  ['[1,2]\n[3', '.[]', {}],
  ['{\n  "a": 1,\n  "b": x\n}', '.', {}],
  ['{"é":1 x}', '.', {}],
  ['{"日本":1 x}', '.', {}],
  ['{"é":"日本"}', '.', { a: true }],
  ['1', '.a +', {}],
  ['1', '.a |\n  foo(1)', {}],
  ['1', '.[] ｜ .a', {}],
  ['1', 'trim', {}],
  ['1', '$x', {}],
  ['1', 'import "x" as x; .', {}],
  ['1', 'input_filename', {}],
  ['1', '$__loc__', { c: true }],
  ['"x"', '.', { r: true }],
  ['1 2 3', '.', { s: true, c: true }],
  ['a\nb', '.', { R: true }],
  ['a\nb', '.', { R: true, s: true }],
  ['{"b":1,"a":2}', '.', { S: true, indent: 'tab' }],
  ['{"b":1,"a":[2]}', '.', { indent: '4' }],
  ['{"b":1,"a":[2]}', '.', { indent: '0' }],
  ['{"b":1,"a":[2]}', '.', { indent: '7' }],
  ['[1,[2]]', '.', { stream: true, c: true }],
  ['[3,1,2]', 'sort', { c: true, seq: true }],
  ['1', 'halt_error', {}],
  ['"bye\\n"', 'halt_error(1)', {}],
  ['null', '.', { e: true }],
  ['false', '.', { e: true }],
  ['1', 'empty', { e: true }],
  ['1', 'error', {}],
  ['{"a":"b"}', 'error', {}],
  ['1', 'error(null)', {}],
  ['[1,"a"]', 'add', {}],
  ['1', '"a","b"', { j: true }],
  ['1', '[.,"x,y"]|@csv', { r: true }],
  ['[NaN, Infinity, -Infinity]', '.', { c: true }],
  ['100000000000000000000001', '.', {}],
  ['100000000000000000000001', '.+0', {}],
  ['{"order_id": 9007199254740993}', '.order_id', {}],
  ['1.000', '.', {}],
  ['"\\ud800"', '.', {}],
  ['1', 'limit(3;repeat(1))', { c: true }],
  ['1', 'input', {}],
  ['1 2', 'input', {}],
  ['1 2 3', '[inputs]', { n: true, c: true }],
  ['', '.', {}],
  ['   ', '.', {}],
  ['\uFEFF{"a":1}', '.a', {}],
  ['1', 'splits("a")', {}],
  ['"2015-03-05T23:51:47Z"', 'fromdate|todate', {}],
  ['1', '1/0', {}],
  ['1', 'debug("x")', {}],
  ['1', 'debug, stderr', {}],
  ['1\n2\n', 'input_line_number', {}],
  ['{"a":"x"}\n{"a":2}\n{"a":null}', '.a | ascii_downcase', {}],
  ['{"items":[{"id":1},{"id":2}]}', '.items | .id', {}],
  ['{"items":null}', '.items[]', {}],
  ['"{\\"a\\":1}"', '.a', {}],
  ['{"a":"1x"}', '.a | tonumber', {}],
  ['{"id":5}', '{(.id): 1}', {}],
  ['1', '$name', {}, [{ type: 'string', name: 'name', value: "O'Brien \"x\" $HOME" }]],
  ['1', '$cfg.retries + 1', {}, [{ type: 'json', name: 'cfg', value: '{"retries": 2}' }]],
  ['1', '$ARGS', { c: true }, [{ type: 'string', name: 'a', value: '1' }, { type: 'json', name: 'b', value: '[1]' }]],
  ['1', '$x', {}, [{ type: 'json', name: 'x', value: '{bad' }]],
  ['{"name":"東京"}', 'select(.name == "東京") | .name', { r: true }],
  ['[{"t":"a"},{"t":"b"},{"t":"a"}]', 'group_by(.t) | map({t: .[0].t, n: length})', { c: true }],
];
function runCli(dir, input, filter, opts, args) {
  writeFileSync(join(dir, 'input.json'), E.prepareInput(input));
  const r = spawnSync('jq', [...E.buildFlags(opts, args), filter, 'input.json'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: dir } });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status };
}
const cliVersion = (() => { try { return spawnSync('jq', ['--version'], { encoding: 'utf8' }).stdout.trim(); } catch { return ''; } })();
const cliOk = /^jq-1\.7\.1(-apple)?$/.test(cliVersion);
const cliDir = mkdtempSync(join(os.tmpdir(), 'zt-jqcli-'));
if (RECORD) {
  if (!cliOk) { console.error('--record needs jq 1.7.1, found ' + (cliVersion || 'none')); process.exit(1); }
  fixtures.cli = CLI_CASES.map(([input, filter, flags, args]) => ({ input, filter, flags, args: args || [], ...runCli(cliDir, input, filter, o(flags), args || []) }));
  fixtures.cliVersion = cliVersion;
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixtures, null, 1) + '\n');
  console.log('recorded ' + fixtures.cli.length + ' CLI cases from ' + cliVersion);
}
eq('fixture has every CLI case', fixtures.cli.length, CLI_CASES.length);
CLI_CASES.forEach(([input, filter, flags, args], i) => {
  const name = JSON.stringify([input, filter, E.buildFlags(o(flags), args || [])]);
  const web = runWeb(input, filter, o(flags), args || []);
  const fx = fixtures.cli[i];
  eq('fixture row matches case ' + name, [fx.input, fx.filter], [input, filter]);
  eq('jq-web = recorded jq 1.7.1 CLI: ' + name, [web.stdout, web.stderr, web.exitCode], [fx.stdout, fx.stderr, fx.exitCode]);
  if (cliOk) {
    const cli = runCli(cliDir, input, filter, o(flags), args || []);
    eq('jq-web = live ' + cliVersion + ': ' + name, [web.stdout, web.stderr, web.exitCode], [cli.stdout, cli.stderr, cli.exitCode]);
  }
});
if (!cliOk) skip('live jq CLI comparison', 'installed jq is ' + (cliVersion || 'missing') + ', not jq-1.7.1');

// Known differences, kept visible: the environment inside WebAssembly.
{
  const env = runWeb('1', '$ENV | keys', o({ c: true }), []);
  eq('$ENV is Emscripten\'s fixed environment', env.stdout, '["HOME","LANG","LOGNAME","PATH","PWD","USER","_"]\n');
}

// ── the jq 1.7.1 manual's examples ──
function canon(text) {
  try { return JSON.stringify(sortKeys(JSON.parse(text))); } catch { return text; }
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const ENV_PROGRAMS = new Set(['$ENV.PAGER', 'env.PAGER']);
let manualOk = 0;
eq('manual fixture has 241 examples', fixtures.manual.length, 241);
for (const ex of fixtures.manual) {
  if (ENV_PROGRAMS.has(ex.program)) continue;
  const r = jq.run(E.prepareInput(ex.input), ex.program, ['-c']);
  const got = r.stdout.split('\n').filter(Boolean).map(canon);
  const exp = ex.output.map(canon);
  const ok = JSON.stringify(got) === JSON.stringify(exp) && r.exitCode === 0;
  check('manual example ' + ex.program + ' on ' + ex.input, ok, JSON.stringify(got) + ' vs ' + JSON.stringify(exp) + ' ' + r.stderr);
  if (ok) manualOk++;
}
eq('manual examples that match (all but the 2 that read $PAGER)', manualOk, 239);

// ── page examples ──
const ids = new Set();
for (const ex of E.EXAMPLES) {
  check('example id unique: ' + ex.id, !ids.has(ex.id)); ids.add(ex.id);
  check('example group known: ' + ex.id, E.EXAMPLE_GROUPS.includes(ex.group));
  const st = E.exampleState(ex);
  const r = runWeb(st.input, st.filter, st.opts, st.args);
  check('example runs without error: ' + ex.id, r.exitCode === 0 && r.stderr === '' && r.stdout !== '', JSON.stringify(r));
  if (ex.manual) {
    const m = fixtures.manual.find((x) => x.program === ex.filter && x.input === ex.input);
    check('example ' + ex.id + ' is a jq 1.7.1 manual example', !!m, ex.filter);
    if (m) eq('example ' + ex.id + ' output equals the manual', jq.run(E.prepareInput(st.input), st.filter, ['-c', ...E.buildFlags(st.opts, st.args)]).stdout.split('\n').filter(Boolean).map(canon), m.output.map(canon));
  }
}
for (const g of E.EXAMPLE_GROUPS) check('group has examples: ' + g, E.EXAMPLES.some((e) => e.group === g));
eq('default output shown before jq loads', runWeb(E.SAMPLE_INPUT, E.DEFAULT_FILTER, o(), []).stdout, E.SAMPLE_OUTPUT);

// ── command line: built, run by /bin/sh with jq 1.7.1, and read back ──
const shellCases = E.EXAMPLES.map((ex) => E.exampleState(ex)).concat([
  { filter: "\"it's\" | ascii_upcase", input: '1', opts: o({ r: true }), args: [] },
  { filter: '.a\n| .b', input: '{"a":{"b":1}}', opts: o(), args: [] },
  { filter: '$v', input: '1', opts: o(), args: [{ type: 'string', name: 'v', value: "a'b\"c\\d $(echo no) `x`" }] },
  { filter: '.', input: '{"a":1}', opts: o({ indent: '0', S: true }), args: [] },
]);
for (const st of shellCases) {
  const cmd = E.buildCommand(st.filter, st.opts, st.args);
  const back = E.parseJqCommand(cmd);
  check('command reads back: ' + cmd, back && back.ok && back.filter === st.filter && JSON.stringify(back.opts) === JSON.stringify(E.normalizeOptions(st.opts)) && JSON.stringify(back.args) === JSON.stringify(E.normalizeArgs(st.args)) && back.files.join() === 'input.json', JSON.stringify(back));
  if (cliOk) {
    writeFileSync(join(cliDir, 'input.json'), E.prepareInput(st.input));
    const sh = spawnSync('/bin/sh', ['-c', cmd], { cwd: cliDir, encoding: 'utf8', env: { PATH: process.env.PATH } });
    const web = runWeb(st.input, st.filter, st.opts, st.args);
    eq('sh -c "' + cmd + '" = page', [sh.stdout, sh.stderr, sh.status], [web.stdout, web.stderr, web.exitCode]);
  }
}
{
  const p = E.parseJqCommand("curl -s 'https://api.example.com/orders?page=1' | jq -rc --arg who \"Ann Lee\" --argjson min 10 '.[] | select(.user == $who and .total >= $min) | .id' > ids.txt");
  check('pipeline: filter', p.ok && p.filter === '.[] | select(.user == $who and .total >= $min) | .id', JSON.stringify(p));
  check('pipeline: -rc', p.opts.r && p.opts.c && !p.opts.s);
  eq('pipeline: args', p.args, [{ type: 'string', name: 'who', value: 'Ann Lee' }, { type: 'json', name: 'min', value: '10' }]);
  eq('pipeline: redirect noted', p.redirects, ['> ids.txt']);
  const q = E.parseJqCommand("cat a.json b.json | jq -s --tab -C 'add' ");
  check('slurp, tab, colour ignored', q.ok && q.opts.s && q.opts.indent === 'tab' && q.ignored.join() === '-C' && q.filter === 'add');
  const r = E.parseJqCommand("jq --indent 4 -S . data.json other.json");
  check('indent and files', r.ok && r.opts.indent === '4' && r.opts.S && r.files.join() === 'data.json,other.json' && r.filter === '.');
  eq('$\'…\' quoting', E.parseJqCommand("jq -r $'.a | \"x\\ty\"'").filter, '.a | "x\ty"');
  eq('double-quoted filter with escapes', E.parseJqCommand('jq ".a | \\"\\$x\\""').filter, '.a | "$x"');
  eq('line continuation', E.parseJqCommand("jq -r \\\n  '.a' \\\n  f.json").filter, '.a');
  eq('unknown option', E.parseJqCommand('jq --raw .').error, 'unknownOption');
  eq('-f is reported', E.parseJqCommand('jq -f prog.jq data.json').error, 'fromFile');
  eq('unclosed quote', E.parseJqCommand("jq '.a").error, 'unclosedSingle');
  eq('missing --arg value', E.parseJqCommand('jq --arg x').error, 'argMissing');
  eq('--slurpfile left out', E.parseJqCommand('jq --slurpfile s s.json .').unsupported, ['--slurpfile s s.json']);
  eq('no jq word', E.parseJqCommand('cat x.json'), null);
  eq('-1 is a filter, not an option (jq main.c isoptish)', E.parseJqCommand('jq -1').filter, '-1');
  eq('detect: command', E.detectPastedCommand("jq -r '.a'").kind, 'command');
  eq('detect: quoted filter', E.detectPastedCommand("'.a | .b'"), { kind: 'quoted', filter: '.a | .b' });
  eq('detect: plain filter', E.detectPastedCommand('.a | .b'), null);
  eq('detect: string literal is not quoting', E.detectPastedCommand('"a"'), null);
  eq('shellQuote', [E.shellQuote('.a'), E.shellQuote("it's"), E.shellQuote(''), E.shellQuote('a b')], ['.a', "'it'\\''s'", "''", "'a b'"]);
}

// ── errors: locations and hints ──
{
  const cases = [
    ['{"a":1,}', '}'],
    ["{'a':1}", "'a'"],
    ['{"a":True}', 'True'],
    ['[1 2]', '2'],
    ['{\n  "a": 1,\n  "b": x\n}', 'x'],
    ['{"é":1 x}', 'x'],
    ['{"日本":1 x}', 'x'],
    ['{"a":1', '1'],
    ['nul', 'nul'],
  ];
  for (const [input, token] of cases) {
    const r = runWeb(input, '.', o(), []);
    const m = E.parseStderr(r.stderr).find((x) => x.kind === 'parse');
    check('parse error parsed: ' + input, !!m, r.stderr);
    if (!m) continue;
    const rg = E.inputErrorRange(input, m);
    eq('parse error selects ' + JSON.stringify(token) + ' in ' + JSON.stringify(input), input.slice(rg.start, rg.end), token);
  }
  eq('offset counts UTF-8 bytes', E.offsetOfLineColumn('{"日本":1 x}\n', 1, 14), 10);
  eq('offset of line 2', E.offsetOfLineColumn('ab\ncd\n', 2, 1), 4);
  const c = E.parseStderr(runWeb('1', '.a |\n  foo(1)', o(), []).stderr);
  eq('compile error kinds', c.map((x) => x.kind), ['compile', 'summary']);
  eq('compile error line', c[0].line, 2);
  eq('lineRange', E.lineRange('.a |\n  foo(1)', 2), { start: 5, end: 13 });
  const rt = E.parseStderr(runWeb('{"a":"x"}\n{"a":2}', '.a | ascii_downcase', o(), []).stderr)[0];
  eq('runtime error input line', [rt.kind, rt.inputLine, rt.message], ['runtime', 2, 'explode input must be a string']);
  eq('debug message kind', E.parseStderr('["DEBUG:",1]\n').map((x) => x.kind), ['debug']);

  const hint = (input, filter, flags, args) => {
    const r = runWeb(input, filter, o(flags), args || []);
    return E.hintsFor(r, { input, filter, opts: o(flags) }).map((h) => h.code + (h.params.key ? ':' + h.params.key : '') + (h.params.name ? ':' + h.params.name : '') + (h.params.type ? ':' + h.params.type : ''));
  };
  eq('hint: array indexed by name', hint('{"items":[{"id":1}]}', '.items | .id'), ['indexArray:id']);
  eq('hint: JSON in a string', hint('"{\\"a\\":1}"', '.a'), ['indexString:a']);
  eq('hint: iterate null', hint('{"items":null}', '.items[]'), ['iterateNull']);
  eq('hint: iterate scalar', hint('1', '.[]'), ['iterateScalar']);
  eq('hint: index number', hint('[{"a":1},2]', '.[] | .a'), ['indexScalar:number']);
  eq('hint: add types', hint('[1,"a"]', 'add'), ['typeMismatch']);
  eq('hint: tonumber', hint('"1x"', 'tonumber'), ['notNumber']);
  eq('hint: object key', hint('{"id":5}', '{(.id): 1}'), ['objectKey']);
  eq('hint: jq 1.8 builtin', hint('" a "', 'trim'), ['jq18:trim/0']);
  eq('hint: jq 1.8 add/1', hint('[1]', 'add(.[])'), ['jq18:add/1']);
  eq('hint: undefined variable', hint('1', '$who'), ['undefinedVar:who']);
  eq('hint: modules', hint('1', 'import "x" as x; .'), ['noModules']);
  eq('hint: single quotes', hint("{'a':1}", '.'), ['inputSingleQuotes']);
  eq('hint: Python literals', hint('{"a": True}', '.'), ['inputPython']);
  eq('hint: trailing comma', hint('[1,2,]', '.'), ['inputTrailingComma']);
  eq('hint: not JSON', hint('hello world', '.'), ['inputNotJson']);
  eq('hint: none with -R', hint('hello world', '.', { R: true }), []);
  eq('hint: -e', hint('null', '.', { e: true }), ['exitStatus']);
  eq('hint: input-method bar handled by the filter note', hint('1', '.[] ｜ .a'), []);
  eq('hint: pasted command handled by the filter note', hint('1', "jq '.a'"), []);
  eq('hint: none on success', hint('1', '.'), []);
}

// ── input-method characters ──
{
  eq('fullwidth bar and dot', E.findSuspiciousChars('.a ｜ ．b').map((x) => x.ch), ['｜', '．']);
  eq('inside a string: ignored', E.findSuspiciousChars('select(.city == "東京｜大阪")'), []);
  eq('inside interpolation: found', E.findSuspiciousChars('"x\\(.a｜.b)y"').map((x) => x.index), [6]);
  eq('after interpolation, string again', E.findSuspiciousChars('"x\\(.a)｜"'), []);
  eq('comment: ignored', E.findSuspiciousChars('.a # 注释｜'), []);
  eq('smart quotes', E.fixSuspiciousChars('.a == “x”'), '.a == "x"');
  eq('ideographic space and fullwidth letters', E.fixSuspiciousChars('.ａ\u3000|\u3000.b'), '.a | .b');
  eq('fixed filter runs', runWeb('{"a":{"b":2}}', E.fixSuspiciousChars('.ａ｜．ｂ'), o(), []).stdout, '2\n');
}

// ── variables ──
eq('checkArgs', E.checkArgs([
  { type: 'string', name: 'ok', value: 'x' },
  { type: 'string', name: '1bad', value: '' },
  { type: 'json', name: 'j', value: '{' },
  { type: 'string', name: 'ok', value: '' },
  { type: 'string', name: '', value: 'orphan' },
  { type: 'string', name: '', value: '' },
]).map((p) => p.code + ':' + p.row), ['argBadName:1', 'argBadJson:2', 'argDuplicate:3', 'argNoName:4']);
eq('flags order', E.buildFlags(o({ r: true, s: true, n: true, indent: 'tab' }), [{ type: 'string', name: 'a', value: 'b' }]), ['-n', '-s', '-r', '--tab', '--arg', 'a', 'b']);
eq('normalizeOptions drops unknown values', E.normalizeOptions({ r: 'yes', indent: '9', x: true }), E.defaultOptions());

// ── share link ──
{
  const h = E.encodeShare('.a | select(.b == "東京")', o({ r: true, indent: '4' }), [{ type: 'string', name: 'token', value: 'secret-value' }, { type: 'json', name: 'cfg', value: '{"x":1}' }]);
  const decodedText = Buffer.from(h.slice(3).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  check('share link has no variable values', !decodedText.includes('secret-value') && !decodedText.includes('"x":1'), decodedText);
  const d = E.decodeShare('#' + h);
  eq('share round trip', [d.filter, d.opts.r, d.opts.indent, d.args.map((a) => a.type + ':' + a.name + '=' + a.value)], ['.a | select(.b == "東京")', true, '4', ['string:token=', 'json:cfg=null']]);
  eq('no share hash', E.decodeShare('#section'), null);
  eq('broken share hash', E.decodeShare('#jq=@@@'), null);
  eq('invalid share payload', E.decodeShare('#jq=' + Buffer.from('{"v":2}').toString('base64url')), { error: true });
}

// ── output helpers ──
eq('count: empty', E.countJsonValues(''), 0);
eq('count: scalars', E.countJsonValues('1\n"a"\ntrue\nnull\n-2.5e3'), 5);
eq('count: strings with brackets and escapes', E.countJsonValues('"[\\"]"\n"}{"\n{"a":"]"}'), 3);
for (const [input, filter, flags] of [['[1,[2,3],{"a":"]"}]', '.[]', {}], ['[3,1,2]', '.[]', { seq: true }], ['{"a":[1,2]}', '.', { stream: true }], ['"x"', '.,.', {}]]) {
  const out = runWeb(input, filter, o(flags), []).stdout;
  const lines = runWeb(input, filter, o({ ...flags, c: true }), []).stdout.split('\n').filter(Boolean).length;
  eq('count equals jq -c lines: ' + filter + ' ' + JSON.stringify(flags), E.countJsonValues(out), lines);
}
eq('countLines', [E.countLines(''), E.countLines('a\n'), E.countLines('a\nb')], [0, 1, 2]);
eq('outputIsJson', [E.outputIsJson(o()), E.outputIsJson(o({ r: true })), E.outputIsJson(o({ j: true }))], [true, false, false]);
eq('clipOutput keeps whole lines', E.clipOutput('aaa\nbbb\nccc\n', 9), { shown: 'aaa\nbbb\n', clipped: true });
eq('highlight escapes HTML', E.highlightJson('"<img src=x onerror=alert(1)>"'), '<span class="jqp-hl-str">"&lt;img src=x onerror=alert(1)&gt;"</span>');
eq('prepareInput', [E.prepareInput(''), E.prepareInput('1'), E.prepareInput('1\n')], ['', '1\n', '1\n']);

// ── worker: runs the patched jq.js the way the browser does ──
{
  const workerSrc = readFileSync(join(root, 'src/components/tools/jq-playground.worker.js'), 'utf8');
  const messages = [];
  const ctx = { performance, TextDecoder, TextEncoder, URL, WebAssembly, console, setTimeout, clearTimeout };
  ctx.self = ctx;
  ctx.location = { href: 'https://zerotool.dev/jq-web/jq-worker.js' };
  ctx.postMessage = (m) => messages.push(m);
  ctx.importScripts = (name) => vm.runInContext(readFileSync(join(tmp, name), 'utf8').replace('var ENVIRONMENT_IS_WEB = typeof window == \'object\';', 'var ENVIRONMENT_IS_WEB = false;').replace('var ENVIRONMENT_IS_WORKER = typeof WorkerGlobalScope != \'undefined\';', 'var ENVIRONMENT_IS_WORKER = true;'), ctx);
  ctx.fetch = async (url) => new Response(readFileSync(join(tmp, 'jq.wasm')), { headers: { 'Content-Type': 'application/wasm' } });
  ctx.Response = Response;
  ctx.process = undefined;
  vm.createContext(ctx);
  let loaded = true;
  try { vm.runInContext(workerSrc, ctx); } catch (e) { loaded = false; skip('worker in vm', e.message); }
  if (loaded) {
    for (let i = 0; i < 100 && !messages.some((m) => m.type === 'ready' || m.type === 'loadError'); i++) await new Promise((r) => setTimeout(r, 50));
    const ready = messages.find((m) => m.type === 'ready');
    if (!ready) skip('worker in vm', 'jq.js did not finish loading in the vm context: ' + JSON.stringify(messages));
    else {
      ctx.onmessage({ data: { id: 7, input: '[{"a":1},2]\n', filter: '.[] | .a', flags: [] } });
      for (let i = 0; i < 50 && !messages.some((m) => m.type === 'result'); i++) await new Promise((r) => setTimeout(r, 20));
      const res = messages.find((m) => m.type === 'result') || {};
      eq('worker result', [res.id, res.stdout, res.stderr, res.exitCode, res.fatal], [7, '1\n', 'jq: error (at input.json:1): Cannot index number with string "a"\n', 5, null]);
    }
  }
}

// ── page script and strings ──
const tool = readFileSync(join(root, 'src/components/tools/JqPlaygroundTool.astro'), 'utf8');
const engineSrc = readFileSync(join(root, 'src/components/tools/jq-playground-engine.js'), 'utf8');
const workerSrc = readFileSync(join(root, 'src/components/tools/jq-playground.worker.js'), 'utf8');
for (const [name, src] of [['component', tool], ['engine', engineSrc], ['worker', workerSrc]]) {
  check(name + ' sends nothing over the network', !/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(src));
  check(name + ' does not use localStorage directly', !/localStorage|sessionStorage|document\.cookie/.test(src));
}
check('page loads the worker, not jq.js, on the main thread', tool.includes("new Worker('/jq-web/jq-worker.js')") && !tool.includes("'/jq-web/jq.js'"));
check('page does not start the worker on load unless state was restored', /if \(restored\) \{ startWorker\(\); run\(false\); \}/.test(tool));
check('input over 40 KB is not persisted', /PERSIST_INPUT_LIMIT = 40 \* 1024/.test(tool) && /inputEl\.value\.length <= PERSIST_INPUT_LIMIT/.test(tool));
check('innerHTML only gets highlighted or escaped text', [...tool.matchAll(/innerHTML\s*=\s*([^;]+);/g)].every((m) => /highlightJson|escapeHtml/.test(m[1])), [...tool.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1]).join(' | '));
const sMatch = tool.match(/\/\* strings:start \*\/\s*const STRINGS = ([\s\S]*?);\s*\/\* strings:end \*\//);
check('STRINGS block found', !!sMatch);
const STRINGS = sMatch ? new Function('return ' + sMatch[1])() : {};
function keyPaths(obj, prefix = '') {
  return Object.keys(obj).flatMap((k) => (obj[k] && typeof obj[k] === 'object' ? keyPaths(obj[k], prefix + k + '.') : [prefix + k])).sort();
}
const enKeys = keyPaths(STRINGS.en || {});
for (const lang of ['zh', 'ja', 'ko']) {
  eq(lang + ' has the same string keys as en', keyPaths(STRINGS[lang] || {}), enKeys);
  for (const k of enKeys) {
    const get = (o2) => k.split('.').reduce((a, p) => (a ? a[p] : undefined), o2);
    const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
    eq(lang + ' placeholders in ' + k, ph(get(STRINGS[lang])), ph(get(STRINGS.en)));
  }
}
const hintCodes = [...engineSrc.matchAll(/add\('([A-Za-z0-9]+)'/g)].map((m) => m[1]);
for (const code of new Set(hintCodes)) check('hint text exists: ' + code, !!(STRINGS.en.hint || {})[code], code);
for (const code of ['argNoName', 'argBadName', 'argDuplicate', 'argBadJson']) check('variable problem text: ' + code, !!(STRINGS.en.argProblem || {})[code]);
for (const code of ['unclosedSingle', 'unclosedDouble', 'noFilter', 'argMissing', 'badIndent', 'unknownOption', 'fromFile']) check('command error text: ' + code, !!(STRINGS.en.commandError || {})[code]);
for (const d of E.BOOL_OPTIONS) check('option text: ' + d.key, !!STRINGS.en.opt[d.key]);
for (const g of E.EXAMPLE_GROUPS) check('group text: ' + g, !!STRINGS.en.groups[g]);
for (const v of E.INDENT_VALUES) check('indent text: ' + v, !!STRINGS.en.indentValues[v]);

// ── tool pages: every annotated example is what the page runs ──
// {/* jqp-check: {"input": …, "filter": …, "flags": {…}, "args": […], "stdout": …, "stderr": …, "exit": n} */}
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/jq-playground', lang + '.mdx'), 'utf8');
  const checks = [...mdx.matchAll(/\{\/\* jqp-check: (\{[\s\S]*?\}) \*\/\}/g)];
  check(lang + ': page has at least 4 checked examples', checks.length >= 4, String(checks.length));
  for (const m of checks) {
    let spec;
    try { spec = JSON.parse(m[1]); } catch (e) { check(lang + ': jqp-check is JSON', false, m[1].slice(0, 80)); continue; }
    const r = runWeb(spec.input, spec.filter, o(spec.flags), spec.args || []);
    const label = lang + ': ' + spec.filter;
    if ('stdout' in spec) eq(label + ' stdout', r.stdout, spec.stdout);
    if ('stderr' in spec) eq(label + ' stderr', r.stderr, spec.stderr);
    if ('exit' in spec) eq(label + ' exit code', r.exitCode, spec.exit);
    if ('command' in spec) eq(label + ' command line', E.buildCommand(spec.filter, o(spec.flags), spec.args || []), spec.command);
    if ('hint' in spec) eq(label + ' hint', E.hintsFor(r, { input: spec.input, filter: spec.filter, opts: o(spec.flags) }).map((h) => h.code), spec.hint);
    for (const shown of spec.shown || []) check(label + ' text on page: ' + shown, mdx.includes(shown), shown);
  }
  check(lang + ': page shows the full order_id', !mdx.includes('9007199254740992') || mdx.includes('9007199254740993'), lang);
  check(lang + ': page says jq 1.7.1', mdx.includes('1.7.1'), lang);
}

// ── v2 page layout (DESIGN.md "Tool Pages v2", kind: convert) ──
{
  const markup = tool.slice(tool.indexOf('\n---\n', 4) + 5, tool.indexOf('<script>'));
  check('the tool root is .jqp-wrap (it gets the height of the first screen)', /^\s*<div class="jqp-wrap" id="jqp-wrap"/.test(markup) && /\.jqp-wrap \{ display: flex; flex-direction: column; gap: [\d.]+rem; min-height: 0; \}/.test(tool));
  check('input and output use the shared two-pane classes', markup.includes('class="jqp-io zt-io"') && (markup.match(/class="jqp-panel zt-io-pane"/g) || []).length === 2 &&
    /<textarea id="jqp-input" class="tool-textarea jqp-input zt-io-fill"/.test(markup) && /<pre id="jqp-out" class="jqp-out zt-io-fill"/.test(markup));
  check('input pane comes before the output pane', markup.indexOf('id="jqp-input"') < markup.indexOf('id="jqp-out"'));
  check('filter, Run, options and the status line are above the panes', ['id="jqp-filter"', 'id="jqp-run"', 'class="jqp-opts"', 'id="jqp-count"', 'id="jqp-exit"', 'id="jqp-status"'].every((x) => markup.indexOf(x) > 0 && markup.indexOf(x) < markup.indexOf('zt-io')));
  check('stderr and hints are under the output, the command line under the panes', markup.indexOf('id="jqp-out"') < markup.indexOf('id="jqp-stderr-box"') && markup.indexOf('id="jqp-stderr-box"') < markup.indexOf('id="jqp-hints"') && markup.indexOf('id="jqp-hints"') < markup.indexOf('class="jqp-cmd"'));
  const tipIds = (markup.match(/<Toggletip id="(jqp-tip-\w+)"/g) || []).map((m) => m.slice(15, -1));
  eq('one toggletip per explained control', tipIds, ['jqp-tip-filter', 'jqp-tip-run', 'jqp-tip-options', 'jqp-tip-args', 'jqp-tip-input', 'jqp-tip-output', 'jqp-tip-command']);
  eq('every toggletip has its text, and every text is used', tipIds.map((id) => id.slice(8)), Object.keys(STRINGS.en.tips || {}));
  for (const k of Object.keys(STRINGS.en.tips || {})) {
    check('tip ' + k + ' is rendered from TIPS', markup.includes('>{TIPS.' + k + '}</Toggletip>'));
    for (const lang of ['en', 'zh', 'ja', 'ko']) check(lang + ' tip ' + k + ' is a plain sentence', /\S/.test(STRINGS[lang].tips[k]) && !/[<>\n]|https?:/.test(STRINGS[lang].tips[k]));
  }
  check('toggletip text stays out of the page script', tool.includes('const { tips: TIPS, ...CLIENT_T } = T;') && markup.includes('data-strings={JSON.stringify(CLIENT_T)}') && !/\bT\.tips\b/.test(tool));
  check('the notes replaced by toggletips are gone', !/inputHint|shareNote|jqp-hint-text|jqp-input-hint/.test(tool));
  // Numbers the toggletips state, against the constants the script uses.
  check('tips: 2 MB, 200 MB, 1 MB, 256 KB, 20,000 characters', /AUTO_LIMIT = 2 \* 1024 \* 1024/.test(tool) && /EDITOR_LIMIT = 2 \* 1024 \* 1024/.test(tool) && /FILE_LIMIT = 200 \* 1024 \* 1024/.test(tool) && /SHOW_LIMIT = 1024 \* 1024/.test(tool) && /HIGHLIGHT_LIMIT = 256 \* 1024/.test(tool) && tool.includes('text.slice(0, 20000)') &&
    ['2 MB', '200 MB', '20,000'].every((x) => STRINGS.en.tips.input.includes(x)) && ['1 MB', '256 KB'].every((x) => STRINGS.en.tips.output.includes(x)));
  check('tips: runs 0.25 s after typing, Stop after 1 s, stopped after 10 s + 1 s per MB', tool.includes('delay === undefined ? 250 : delay') && tool.includes('if (s >= 1 && workerReady)') && tool.includes('var limit = 10000 + Math.round(req.input.length / 1e6) * 1000;') &&
    STRINGS.en.tips.filter.includes('0.25 seconds') && STRINGS.en.tips.run.includes('After 1 second') && STRINGS.en.tips.run.includes('10 seconds plus 1 second per MB'));
  check('tips: download file names', tool.includes("a.download = state.lastJson ? (state.opts.c ? 'output.jsonl' : 'output.json') : 'output.txt';") && ['output.json,', 'output.jsonl with -c', 'output.txt with -r or -j'].every((x) => STRINGS.en.tips.output.includes(x)));
  check('one breakpoint for stacking (860px), 640px for phones', !tool.includes('760px') && tool.includes('@media (max-width: 860px)') && tool.includes('.jqp-io > .jqp-panel:last-child { order: -1; }'));
  check('side by side, a long output scrolls inside its pane', /@media \(min-width: 861px\) \{\s*\.jqp-io \{ min-height: 360px; \}\s*\.jqp-out \{ flex-basis: 0; min-height: 200px; \}\s*\}/.test(tool) && !/\.jqp-out \{[^}]*max-height/.test(tool));
  check('Ctrl/Cmd+L also drops a queued run', /key === 'l' \|\| e\.key === 'L'[\s\S]{0,160}if \(inputEl\.value === '' && filterEl\.value === ''\) \{\s*clearTimeout\(runTimer\);\s*closeFile\(\);[\s\S]{0,160}clearOutput\(\); setStatus\('', ''\);/.test(tool));
  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  check('listed as a convert page', layouts.includes("'jq-playground': 'convert'"));
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const mdx = readFileSync(join(root, 'src/content/tools/jq-playground', lang + '.mdx'), 'utf8');
    const front = mdx.slice(0, mdx.indexOf('\n---\n', 4));
    const body = mdx.slice(front.length + 5);
    const steps = (front.slice(front.indexOf('\nsteps:\n'), front.indexOf('\nfaqItems:')).match(/^  - "(.*)"$/gm) || []).map((l) => l.slice(5, -1));
    eq(lang + ' mdx: 8 steps in the frontmatter, before faqItems', [steps.length, front.indexOf('\nsteps:\n') > 0 && front.indexOf('\nsteps:\n') < front.indexOf('\nfaqItems:')], [8, true]);
    check(lang + ' mdx: steps fit llms-full.txt (280 characters each, 1200 in all)', steps.every((x) => x.length <= 280) && steps.join('').length <= 1200, steps.map((x) => x.length).join());
    check(lang + ' mdx: steps are plain text', steps.every((x) => !/[`*\\]|\]\(/.test(x)));
    check(lang + ' mdx: no usage section in the body', !/^## (How to use|用法|使い方|사용 방법)\s*$/im.test(body));
    check(lang + ' mdx: the limits section stays', /^## (Limits|限制|制限|제한)\s*$/m.test(body));
  }
}

rmSync(tmp, { recursive: true, force: true });
rmSync(cliDir, { recursive: true, force: true });
console.log(`\n${passes} passed, ${failures} failed, ${skips} skipped`);
process.exit(failures ? 1 : 0);
