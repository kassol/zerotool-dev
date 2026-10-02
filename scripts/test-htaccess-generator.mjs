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
// The ja guide (src/content/blog/htaccess-generator-guide/ja.mdx) quotes the default output
// (`hta-default`) and Apache 2.4 results (`hta-apache`): each case writes the .htaccess body to a
// temporary document root, starts Apache with `-X` and the given AllowOverride / Options /
// mod_access_compat, and checks status codes, Cache-Control, Location and error-log text.
// Apache cases are skipped when no Apache 2.4 binary with modules is found.
//
// Run: node scripts/test-htaccess-generator.mjs

import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
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

// Apache 2.4's mime.types maps .ttf to font/ttf; a rule for application/x-font-ttf alone never
// matches there (checked with Apache 2.4.67: no Expires header on a .ttf file).
const cache = form({ cacheEnable: on, cacheImages: { value: '1 year' }, cacheCss: { value: '1 month' }, cacheFonts: { value: '1 year' } });
check('TTF caching uses font/ttf', /ExpiresByType font\/ttf "access plus 1 year"/.test(cache), cache);
check('TTF caching keeps the legacy application/x-font-ttf type', /ExpiresByType application\/x-font-ttf "access plus 1 year"/.test(cache), cache);
check('JavaScript caching covers text/javascript', /ExpiresByType text\/javascript "access plus 1 month"/.test(cache), cache);

// ---------- ja guide: default output and Apache 2.4 runs ----------
// The default form state is read from the component markup (checked boxes, input values,
// selected options), so the guide's "default output" follows the shipped tool.
function defaultEls() {
  const map = {
    https: 'hta-https', wwwEnable: 'hta-www-enable', indexEnable: 'hta-index-enable', indexFiles: 'hta-index-files',
    cacheEnable: 'hta-cache-enable', cacheImages: 'hta-cache-images', cacheCss: 'hta-cache-css', cacheFonts: 'hta-cache-fonts',
    secEnable: 'hta-security-enable', secDirListing: 'hta-sec-dirlisting', secHtaccess: 'hta-sec-htaccess',
    secEnvFiles: 'hta-sec-envfiles', secXss: 'hta-sec-xss', redirEnable: 'hta-redir-enable',
    redirFrom: 'hta-redir-from', redirTo: 'hta-redir-to', redirType: 'hta-redir-type',
  };
  const els = {};
  for (const [key, id] of Object.entries(map)) {
    const tagMatch = new RegExp('<(input|select)[^>]*id="' + id + '"[^>]*>').exec(source);
    if (!tagMatch) { els[key] = { checked: false, value: '' }; continue; }
    const tag = tagMatch[0];
    if (tagMatch[1] === 'select') {
      const body = source.slice(tagMatch.index, source.indexOf('</select>', tagMatch.index));
      const sel = /<option value="([^"]+)" selected/.exec(body) || /<option value="([^"]+)"/.exec(body);
      els[key] = { checked: false, value: sel[1] };
    } else {
      const val = /value="([^"]*)"/.exec(tag);
      els[key] = { checked: /\schecked\b/.test(tag), value: val ? val[1] : '' };
    }
  }
  return els;
}
const toolDefault = makeLines(defaultEls())();
check('default form state enables HTTPS, index, caching and three security items',
  /# Force HTTPS/.test(toolDefault) && /DirectoryIndex index\.php index\.html index\.htm/.test(toolDefault) &&
  /ExpiresActive On/.test(toolDefault) && /Options -Indexes/.test(toolDefault) && !/X-XSS-Protection/.test(toolDefault), toolDefault);
const toolDefaultNoHttps = toolDefault.slice(toolDefault.indexOf('# Directory Index'));

const guidePath = join(root, 'src/content/blog/htaccess-generator-guide/ja.mdx');
const guide = readFileSync(guidePath, 'utf8');
const fm = /^---\n([\s\S]*?)\n---/.exec(guide)[1];
check('ja guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
const h2 = [...guide.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
check('ja guide has no template headings', !h2.some((h) => /online|オンライン|まとめ/i.test(h)), h2.join(' | '));
const defIdx = guide.indexOf('{/* hta-default */}');
const defBlock = /```apache\n([\s\S]*?)\n```/.exec(guide.slice(defIdx));
check('ja guide quotes the tool default output verbatim', defIdx >= 0 && defBlock && defBlock[1] === toolDefault, defBlock && defBlock[1]);

// Each `hta-apache` annotation names the .htaccess body: "ht" (a literal, "tool-default" or
// "tool-default-no-https") or, when absent, the closest ```apache block above it.
const cases = [];
for (const m of guide.matchAll(/\{\/\* hta-apache: (.+?) \*\/\}/g)) {
  const spec = JSON.parse(m[1]);
  if (spec.ht === 'tool-default') spec.body = toolDefault + '\n';
  else if (spec.ht === 'tool-default-no-https') spec.body = toolDefaultNoHttps + '\n';
  else if (spec.ht) spec.body = spec.ht;
  else {
    const before = guide.slice(0, m.index);
    const blocks = [...before.matchAll(/```apache\n([\s\S]*?)```/g)];
    spec.body = blocks[blocks.length - 1][1];
  }
  cases.push(spec);
}
check('ja guide has Apache cases', cases.length >= 8, cases.length);

// Apache runs only where an Apache 2.4 binary and its module directory exist (macOS ships
// /usr/sbin/httpd with /usr/libexec/apache2; Debian / Ubuntu use /usr/sbin/apache2 with
// /usr/lib/apache2/modules). Set HTTPD and HTTPD_MODULES to point elsewhere. Otherwise SKIP.
const httpdCandidates = [[process.env.HTTPD, process.env.HTTPD_MODULES], ['/usr/sbin/httpd', '/usr/libexec/apache2'], ['/usr/sbin/apache2', '/usr/lib/apache2/modules']];
const found = httpdCandidates.find(([bin, mods]) => bin && mods && existsSync(bin) && existsSync(join(mods, 'mod_rewrite.so')));
const mimeTypes = ['/private/etc/apache2/mime.types', '/etc/mime.types'].find((f) => existsSync(f));
let skipped = 0;
if (!found || !mimeTypes) {
  skipped = cases.length;
} else {
  const [httpdBin, modDir] = found;
  const base = mkdtempSync(join(tmpdir(), 'hta-'));
  const docs = join(base, 'docs');
  mkdirSync(join(docs, 'app'), { recursive: true });
  mkdirSync(join(docs, 'emptydir'));
  writeFileSync(join(docs, 'index.html'), 'hello\n');
  writeFileSync(join(docs, 'index.php'), 'php\n');
  writeFileSync(join(docs, 'app.css'), 'css\n');
  writeFileSync(join(docs, 'a.ttf'), 'ttf\n');
  writeFileSync(join(docs, '.env'), 'SECRET=1\n');
  writeFileSync(join(docs, 'app', 'foo'), 'foo\n');
  const port = 18000 + Math.floor(Math.random() * 1000);
  const mods = ['mpm_prefork', 'unixd', 'authz_core', 'authz_host', 'dir', 'mime', 'log_config', 'rewrite', 'expires', 'headers', 'alias', 'autoindex'];
  function conf(spec) {
    const lines = [
      'ServerRoot "' + base + '"', 'Listen 127.0.0.1:' + port, 'ServerName localhost',
      ...mods.filter((m) => existsSync(join(modDir, 'mod_' + m + '.so'))).map((m) => `LoadModule ${m}_module ${join(modDir, 'mod_' + m + '.so')}`),
      ...(spec.compat ? [`LoadModule access_compat_module ${join(modDir, 'mod_access_compat.so')}`] : []),
      'TypesConfig ' + mimeTypes, 'PidFile ' + join(base, 'httpd.pid'), 'ErrorLog ' + join(base, 'error.log'), 'LogLevel warn',
      'DocumentRoot "' + docs + '"',
      '<Files ".ht*">', '  Require all denied', '</Files>',
      '<Directory "' + docs + '">', '  Options ' + (spec.options || 'FollowSymLinks'), '  AllowOverride ' + spec.override, '  Require all granted', '</Directory>',
    ];
    return lines.join('\n') + '\n';
  }
  function request(path) {
    return new Promise((resolve) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, headers: { Host: 'example.test' } }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, cc: res.headers['cache-control'] || null, loc: res.headers.location || null }));
      });
      req.on('error', () => resolve(null));
      req.end();
    });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const spec of cases) {
    const label = 'Apache ' + JSON.stringify(spec.requests) + ' ' + (spec.override) + (spec.compat ? ' +compat' : '');
    writeFileSync(join(docs, '.htaccess'), spec.body);
    writeFileSync(join(base, 'error.log'), '');
    writeFileSync(join(base, 'httpd.conf'), conf(spec));
    const child = spawn(httpdBin, ['-X', '-f', join(base, 'httpd.conf')], { stdio: 'ignore' });
    let ready = null;
    for (let i = 0; i < 50 && !ready; i++) { await sleep(100); ready = await request('/__ping'); }
    if (!ready) { child.kill('SIGKILL'); skipped += 1; continue; }
    for (const [path, status, cc, loc] of spec.requests) {
      const r = await request(path);
      check(label + ' ' + path + ' status', r && r.status === status, r && r.status);
      if (cc !== undefined && cc !== null) check(label + ' ' + path + ' Cache-Control', r && r.cc === cc, r && r.cc);
      if (loc !== undefined && loc !== null) check(label + ' ' + path + ' Location', r && r.loc === loc, r && r.loc);
    }
    child.kill('SIGTERM');
    await new Promise((r) => child.on('exit', r));
    if (spec.log) check(label + ' error log mentions ' + spec.log, readFileSync(join(base, 'error.log'), 'utf8').includes(spec.log));
  }
  rmSync(base, { recursive: true, force: true });
}
if (skipped) console.log(`SKIP: ${skipped} Apache cases (no Apache 2.4 binary with modules found, or it did not start)`);

console.log(`\n${passes} passed, ${failures} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failures ? 1 : 0);
