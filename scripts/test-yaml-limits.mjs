// js-yaml 4.3 work limits — the localized error text on every tool page that reads YAML
//
// Read:  node_modules js-yaml (4.3.2: maxDepth 100, maxTotalMergeKeys 10000, at most 100
//        mappings in one merge key), src/components/tools/yaml-limits.js, the components of
//        yaml-json, yaml-toml, yaml-validator, json-schema-validator and openapi-to-typescript
//        (run through scripts/astro-page-harness.mjs or their engine blocks) and the OpenAPI
//        Validator engine + format modules with the frontmatter STRINGS
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Each input really hits the limit in the installed js-yaml; the page must show the limit in
// the page language with the number, never the English library reason, and a converter must
// clear its old output and disable its copy button. Pages that state the limits must state the
// numbers the library uses.
//
// Run: node scripts/test-yaml-limits.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import jsyaml from 'js-yaml';
import { loadPage } from './astro-page-harness.mjs';
import { yamlLimitText, yamlErrorText, YAML_LIMITS } from '../src/components/tools/yaml-limits.js';
import * as OAE from '../src/components/tools/openapi-validator-engine.js';
import * as OAF from '../src/components/tools/openapi-validator-format.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const LANGS = ['en', 'zh', 'ja', 'ko'];
let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + (detail !== undefined ? '\n  ' + JSON.stringify(detail) : '')); }
}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ENGLISH = /maxDepth|maxTotalMergeKeys|abnormal merge sequence size/;
const DEEP = 'a: ' + '['.repeat(101) + ']'.repeat(101);                       // depth 102
const DEEP_BLOCK = Array.from({ length: 101 }, (_, i) => ' '.repeat(i * 2) + 'k:').join('\n') + ' 1'; // 101 nested mappings + root
const MERGE_KEYS = 'base: &b {x: 1}\nitems:\n' + '  - {<<: *b}\n'.repeat(5001);     // 10,002 merge work units
const MERGE_SOURCES = 'b: &b {x: 1}\nr: {<<: [' + Array(101).fill('*b').join(',') + ']}';
const CASES = [
  ['depth', DEEP, '100'], ['depth (block)', DEEP_BLOCK, '100'],
  ['merge keys', MERGE_KEYS, '10000'], ['merge sources', MERGE_SOURCES, '100'],
];

/* ── the library and the shared module ── */
check('js-yaml is 4.3.2', require('js-yaml/package.json').version === '4.3.2');
const loaderSrc = readFileSync(join(root, 'node_modules/js-yaml/lib/loader.js'), 'utf8');
check('maxDepth default matches YAML_LIMITS', loaderSrc.includes("options['maxDepth'] : " + YAML_LIMITS.maxDepth));
check('maxTotalMergeKeys default matches YAML_LIMITS', loaderSrc.includes("options['maxTotalMergeKeys'] : " + YAML_LIMITS.maxTotalMergeKeys));
check('merge sequence limit matches YAML_LIMITS', loaderSrc.includes('valueNode.length > ' + YAML_LIMITS.maxMergeSources));
const errors = {};
for (const [name, text] of CASES) {
  try { jsyaml.load(text); errors[name] = null; } catch (e) { errors[name] = e; }
  check('js-yaml rejects ' + name, !!errors[name] && ENGLISH.test(errors[name].reason), errors[name] && errors[name].reason);
}
check('a document just under the limits loads', (() => { try { jsyaml.load('a: ' + '['.repeat(99) + ']'.repeat(99)); jsyaml.load('base: &b {x: 1}\nitems:\n' + '  - {<<: *b}\n'.repeat(5000)); return true; } catch { return false; } })());
for (const lang of LANGS) {
  for (const [name, , n] of CASES) {
    const t = yamlLimitText(errors[name].reason, lang);
    check(`${lang} ${name}: localized text with ${n}`, !!t && t.includes(n) && !ENGLISH.test(t), t);
    const line = yamlErrorText(errors[name], lang);
    check(`${lang} ${name}: one line with (line:column)`, /\(\d+:\d+\)$/.test(line) && !line.includes('\n'), line);
  }
  check(lang + ': other reasons are not localized', yamlLimitText('duplicated mapping key', lang) === null);
}

/* ── converter pages ── */
const PAGES = [
  ['yaml-json', 'src/components/tools/YamlJsonTool.astro', '.yj-wrap', 'yj-yaml', 'yj-json', 'yj-copy-json', 'yj-status', '{"ok":1}', null],
  ['yaml-toml', 'src/components/tools/YamlTomlTool.astro', '.yt-wrap', 'yt-yaml', 'yt-toml', 'yt-copy-toml', 'yt-status', 'ok: 1', null],
];
for (const [tool, file, wrap, input, output, copy, status, , button] of PAGES) {
  for (const lang of LANGS) {
    for (const [name, text, n] of CASES) {
      const page = loadPage(file, { lang, stringsSelector: wrap });
      page.type(input, 'ok: 1');
      const before = page.el(output).value;
      page.type(input, text);
      const s = page.el(status).textContent;
      const want = yamlLimitText(errors[name].reason, lang);
      check(`${tool} ${lang} ${name}: localized limit in the status`, !!want && s.includes(want) && !ENGLISH.test(s) && s.includes(n), s);
      check(`${tool} ${lang} ${name}: old output cleared and copy disabled`, before !== '' && page.el(output).value === '' && page.el(copy).disabled === true, { before, after: page.el(output).value });
      if (button) {
        page.el(input).value = text; page.el(button).click();
        check(`${tool} ${lang} ${name}: button gives the same status`, page.el(status).textContent === s);
      }
    }
  }
}

/* ── yaml-validator page ── */
{
  const src = readFileSync(join(root, 'src/components/tools/YamlValidatorTool.astro'), 'utf8');
  const labels = vm.runInNewContext(src.slice(src.indexOf('const labels = '), src.indexOf('const L = labels')) + '\n;labels');
  for (const lang of LANGS) {
    const L = labels[lang];
    const dataset = { lang, msgEmpty: L.msgEmpty, msgValid: L.msgValid, msgInvalid: L.msgInvalid, msgValidMulti: L.msgValidMulti, msgInvalidMulti: L.msgInvalidMulti, docTitle: L.docTitle, docLines: L.docLines, docValid: L.docValid, copyJson: L.copyJson, copied: L.copied, errTitle: L.errTitle, errLine: L.errLine, errLineCol: L.errLineCol };
    for (const [name, text, n] of CASES) {
      const page = loadPage('src/components/tools/YamlValidatorTool.astro', { lang, dataset: { '.yv-wrap': dataset } });
      page.el('yv-input').value = text;
      page.el('yv-validate').click();
      const html = page.el('yv-error-box').innerHTML || '';
      const want = esc(yamlLimitText(errors[name].reason, lang));
      check(`yaml-validator ${lang} ${name}: localized reason`, !!want && html.includes(want) && !ENGLISH.test(html) && html.includes(n), html.slice(0, 300));
      check(`yaml-validator ${lang} ${name}: title and location in the page language`, !!L.errTitle && html.includes(esc(L.errTitle)) && !html.includes('Syntax Error') &&
        html.includes(esc(L.errLineCol.split('{')[0])), html.slice(0, 200));
    }
  }
}

/* ── openapi-validator: yamlReasons with a number ── */
{
  const comp = readFileSync(join(root, 'src/components/tools/OpenapiValidatorTool.astro'), 'utf8');
  const sm = /\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/.exec(comp);
  const STRINGS = new Function(sm[1] + '\nreturn STRINGS;')();
  for (const [name, text, n] of CASES) {
    const parsed = OAE.parseText('openapi: 3.1.0\n' + text, jsyaml);
    check(`openapi engine reports ${name} as a YAML error`, !!parsed.error && ENGLISH.test(parsed.error.reason), parsed.error);
    for (const lang of LANGS) {
      const msg = OAF.formatMessage({ code: 'parse.yaml', args: { reason: parsed.error.reason } }, STRINGS[lang]);
      check(`openapi ${lang} ${name}: localized with ${n}`, !ENGLISH.test(msg) && msg.includes(n) && msg.includes(yamlLimitText(parsed.error.reason, lang)), msg);
    }
  }
  for (const lang of LANGS) {
    const keys = Object.keys(STRINGS[lang].yamlReasons).filter((k) => k.includes('{n}'));
    check(`openapi ${lang}: number patterns in yamlReasons`, keys.length === 2, keys);
  }
}

/* ── json-schema-validator: parse errors (CORE_SCHEMA has no merge keys, so only depth) ── */
{
  const source = readFileSync(join(root, 'src/components/tools/JsonSchemaValidatorTool.astro'), 'utf8');
  const E = await import(pathToFileURL(join(root, 'src/components/tools/json-schema-validator-engine.js')).href);
  const STRINGS = new Function(source.slice(source.indexOf('const STRINGS = '), source.indexOf('const S = STRINGS')) + '\nreturn STRINGS;')();
  for (const lang of LANGS) {
    for (const text of [DEEP_BLOCK, 'x: 1\nb: ' + '['.repeat(101) + ']'.repeat(101)]) {
      const r = E.parseDocs(text, 'data', { yaml: jsyaml });
      const msg = r.format === 'error' ? E.parseErrorText(r.error, STRINGS[lang]) : '';
      check(`json-schema-validator ${lang}: depth limit localized`, r.format === 'error' && !ENGLISH.test(msg) && msg.includes('100') && msg.includes(yamlLimitText('nesting exceeded maxDepth (100)', lang)), msg);
    }
  }
}

/* ── openapi-to-typescript page ── */
{
  for (const lang of LANGS) {
    const page = loadPage('src/components/tools/OpenapiToTypescriptTool.astro', { lang, dataset: { '.opts-wrap': { lang } } });
    const text = 'openapi: 3.0.0\nx: ' + '['.repeat(101) + ']'.repeat(101);
    page.el('opts-input').value = text;
    page.run('generate()');
    const s = page.run('statusEl.textContent');
    check(`openapi-to-typescript ${lang}: depth limit localized`, !ENGLISH.test(s) && s.includes(yamlLimitText('nesting exceeded maxDepth (100)', lang)), s);
  }
}

/* ── pages that state the limits ── */
for (const lang of LANGS) {
  for (const tool of ['yaml-json', 'yaml-toml', 'yaml-validator', 'openapi-validator']) {
    const text = readFileSync(join(root, 'src/content/tools', tool, lang + '.mdx'), 'utf8');
    check(`${tool} ${lang} page states js-yaml 4.3.2 and the limits 100 / 10,000 / 100`,
      text.includes('js-yaml 4.3.2') && text.includes('100') && text.includes('10,000') && !/js-yaml[^\n]{0,40}4\.1\.1|js-yaml 4\.1\b/.test(text));
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
