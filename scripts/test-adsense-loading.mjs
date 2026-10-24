// Read: BaseLayout's actual AdSense bootstrap, AdUnit, installed Astro compiler,
// and dist (or the directory given as the first argument) for rendered four-language gates.
// Write: stdout only. No network, real publisher ID, storage, or live ad requests.
// The clock drives real lifecycle callbacks, rather than waiting a fixed timeout.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import domino from '@mixmark-io/domino';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('src/layouts/BaseLayout.astro', root), 'utf8');
const unit = readFileSync(new URL('src/components/AdUnit.astro', root), 'utf8');
const match = source.match(/<script is:inline id="zt-adsense-bootstrap" define:vars=\{\{ adsenseId \}\}>([\s\S]*?)<\/script>/);
let passes = 0, failures = 0;
function check(label, condition) {
  if (condition) passes++;
  else { failures++; console.log('FAIL: ' + label); }
}
check('non-article ad loading yields to content paint', !!match);
if (match) {
  function open({ ready = 'loading', visible = true, idle = true } = {}) {
    const listeners = new Map(), frames = [], idles = [], timers = [], scripts = [];
    let stage = 'parse';
    const queue = [{}];
    const document = {
      readyState: ready, visibilityState: visible ? 'visible' : 'hidden',
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      getElementById(id) { return scripts.find(script => script.id === id) || null; },
      createElement(tag) { return { tag }; },
      head: { appendChild(script) { scripts.push({ ...script, stage }); } },
    };
    const window = {
      adsbygoogle: queue,
      requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
      setTimeout(fn) { timers.push(fn); return timers.length; },
      ...(idle ? { requestIdleCallback(fn, options) { idles.push({ fn, options }); return idles.length; } } : {}),
    };
    const context = vm.createContext({ document, window, adsenseId: 'ca-pub-XXXX' });
    const run = () => vm.runInContext(match[1], context);
    function event(type) { for (const fn of [...(listeners.get(type) || [])]) fn(); }
    return {
      document, window, scripts, frames, idles, timers, queue, run,
      ready() { document.readyState = 'interactive'; stage = 'dom-ready'; event('DOMContentLoaded'); },
      visible(value) { document.visibilityState = value ? 'visible' : 'hidden'; event('visibilitychange'); },
      frame() { stage = 'frame-' + (stage === 'frame-1' ? 2 : 1); const pending = frames.splice(0); for (const fn of pending) fn(); },
      idle() { stage = 'idle'; const pending = idles.splice(0); for (const job of pending) job.fn(); },
      timeout() { stage = 'timer'; const pending = timers.splice(0); for (const fn of pending) fn(); },
    };
  }
  for (const ready of ['loading', 'interactive', 'complete']) {
    for (const idle of [false, true]) {
      const p = open({ ready, idle });
      p.run();
      check(ready + '/' + idle + ': no request during parsing', p.scripts.length === 0);
      if (ready === 'loading') {
        check('loading document waits for DOM ready', p.frames.length === 0);
        p.ready();
      }
      check('ready document schedules a paint opportunity', p.frames.length === 1);
      p.frame();
      check('first frame does not start ads before paint', p.scripts.length === 0);
      p.frame();
      check('second frame yields before the request', p.scripts.length === 0);
      if (idle) {
        check('idle work has a bounded starvation fallback', p.idles[0]?.options?.timeout > 0);
        p.idle();
      } else p.timeout();
      const script = p.scripts[0];
      check('exactly one vendor script', p.scripts.length === 1);
      check('original vendor endpoint and client', script?.src === 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXX');
      check('script remains async and anonymous', script?.async === true && script?.crossOrigin === 'anonymous');
      check('manual ad queue survives bootstrap', p.window.adsbygoogle === p.queue && p.queue.length === 1);
      p.run(); p.ready(); p.frame(); p.frame(); p.idle(); p.timeout();
      check('repeated bootstrap cannot duplicate a request', p.scripts.length === 1);
    }
  }
  {
    const p = open({ ready: 'complete', visible: false });
    p.run(); p.frame(); p.frame(); p.idle(); p.timeout();
    check('hidden page does not load ads', p.scripts.length === 0);
    p.visible(true); p.frame(); p.frame(); p.idle(); p.timeout();
    check('visible page resumes ad loading', p.scripts.length === 1);
    p.visible(false); p.visible(true); p.frame(); p.frame(); p.idle();
    check('visibility changes do not duplicate loading', p.scripts.length === 1);
  }
  for (const idle of [false, true]) {
    const p = open({ ready: 'complete', idle });
    p.run(); p.frame(); p.frame();
    p.visible(false); p.idle(); p.timeout();
    check('tab hidden before idle still postpones loading', p.scripts.length === 0);
    p.visible(true); p.frame(); p.frame(); p.idle(); p.timeout();
    check('postponed idle loads once on return', p.scripts.length === 1);
  }
  check('AdUnit retains its ordinary adsbygoogle queue', /\(adsbygoogle = window\.adsbygoogle \|\| \[\]\)\.push\(\{\}\)/.test(unit));
  const require = createRequire(new URL('package.json', root));
  const { transform } = await import(require.resolve('@astrojs/compiler', { paths: [require.resolve('astro')] }));
  const compiled = await transform(source, { filename: 'src/layouts/BaseLayout.astro' });
  check('Astro compiles the gated bootstrap', !compiled.diagnostics.some(diagnostic => diagnostic.severity === 1));
}
const dist = resolve(process.argv[2] || fileURLToPath(new URL('dist/', root)));
if (existsSync(resolve(dist, 'index.html'))) {
  function rendered(path) {
    const html = readFileSync(resolve(dist, path, 'index.html'), 'utf8');
    const document = domino.createWindow(html).document;
    return {
      bootstrap: !!document.getElementById('zt-adsense-bootstrap'),
      vendors: [...document.querySelectorAll('script[src]')].filter(script => script.getAttribute('src').includes('adsbygoogle.js')),
      analytics: [...document.querySelectorAll('script[src]')].filter(script => script.getAttribute('src').includes('googletagmanager.com')),
    };
  }
  const home = rendered('');
  const configured = home.bootstrap;
  console.log('Rendered AdSense configuration: ' + (configured ? 'enabled' : 'empty'));
  for (const lang of ['', 'zh', 'ja', 'ko']) {
    const prefix = lang ? lang + '/' : '';
    for (const path of ['', 'tools', 'tools/json-formatter']) {
      const output = rendered(prefix + path);
      check(prefix + path + ': rendered bootstrap matches configured publisher', output.bootstrap === configured);
      check(prefix + path + ': vendor is not requested by the parser', output.vendors.length === 0);
    }
    const sensitive = rendered(prefix + 'tools/aes-encrypt-decrypt');
    check(prefix + 'AES: neither ad path is rendered', !sensitive.bootstrap && sensitive.vendors.length === 0);
    check(prefix + 'AES: analytics vendor stays absent', sensitive.analytics.length === 0);
    const article = rendered(prefix + 'blog/gif-compressor-guide');
    check(prefix + 'article: top ad retains its existing vendor path', article.vendors.length === (configured ? 1 : 0) && !article.bootstrap);
    if (configured) check(prefix + 'article: async/anonymous properties retained',
      article.vendors[0].hasAttribute('async') && article.vendors[0].getAttribute('crossorigin') === 'anonymous');
  }
} else console.log('SKIP: dist not built; rendered publisher/sensitive gates need a build');
console.log(`AdSense loading: ${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
