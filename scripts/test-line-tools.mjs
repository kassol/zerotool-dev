// Line Tools — complete page events and shared keyboard lifecycle.
// Read: src/components/tools/LineToolsTool.astro, src/layouts/ToolLayout.astro.
// Write: stdout only; no browser, network, storage, or system clipboard.
// Exit: 0 when all checks pass, 1 on any failure.
// The actual markup and complete IIFE run in a small DOM substitute. Clipboard
// promises, the clock, persistence clear, and the shuffle random source are controlled.
// Run: node scripts/test-line-tools.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { load as loadYaml } from 'js-yaml';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/LineToolsTool.astro'), 'utf8');
const strings = vm.runInNewContext(source.slice(source.indexOf('const STRINGS ='), source.indexOf('const T = STRINGS[lang]')).replace(/\bas const\b/g, '') + '\nSTRINGS;');
const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw new Error('Missing shared shortcut');
let passes = 0, failures = 0;
function check(name, actual, expected = true) {
  if (isDeepStrictEqual(actual, expected)) { passes++; return; }
  failures++;
  console.log('FAIL ' + name + ' — actual=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
}
const unhandled = [];
const onUnhandled = error => unhandled.push(String(error));
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
process.on('unhandledRejection', onUnhandled);

function page(lang = 'en', shellFirst = false) {
  const SLUG = 'line-tools';
  const ids = new Map(), copies = [], clears = [], docEvents = {}, timers = new Map(), tracked = [];
  let now = 0, timerId = 0;
  const doc = { documentElement: { lang }, activeElement: null };
  function simple(e, sel) {
    if (sel.includes(':checked') && !e.checked) return false;
    sel = sel.replace(':checked', '');
    const attrs = [...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    sel = sel.replace(/\[[^\]]+\]/g, '');
    const tag = /^[\w-]+/.exec(sel), id = /#([\w-]+)/.exec(sel), classes = [...sel.matchAll(/\.([\w-]+)/g)];
    return (!tag || e.tagName === tag[0].toUpperCase()) && (!id || e.id === id[1]) && classes.every(m => e.classList.contains(m[1])) && attrs.every(m => m[2] === undefined ? e.getAttribute(m[1]) !== null : e.getAttribute(m[1]) === m[2]);
  }
  function matches(e, selector) {
    return selector.split(',').some(sel => {
      const parts = sel.trim().split(/\s+(?![^\[]*\])/);
      if (!simple(e, parts.pop())) return false;
      for (let n = e.parentElement; parts.length;) {
        while (n && !simple(n, parts.at(-1))) n = n.parentElement;
        if (!n) return false;
        parts.pop(); n = n.parentElement;
      }
      return true;
    });
  }
  class Element {
    constructor(tag = 'div') {
      Object.assign(this, { tagName: tag.toUpperCase(), id: '', className: '', type: tag === 'input' ? 'text' : '', value: '', textContent: '', checked: false, readOnly: false, disabled: false, attributes: {}, children: [], parentElement: null, listeners: {} });
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (['id', 'type', 'value', 'class'].includes(k)) this[k === 'class' ? 'className' : k] = String(v);
      if (k === 'readonly') this.readOnly = true;
      if (k === 'disabled') this.disabled = true;
      if (k === 'checked') this.checked = true;
    }
    getAttribute(k) { return this.attributes[k] ?? null; }
    get classList() {
      const e = this;
      return {
        contains: k => e.className.split(/\s+/).includes(k),
        add(...keys) { e.className = [...new Set([...e.className.split(/\s+/).filter(Boolean), ...keys])].join(' '); },
        remove(...keys) { e.className = e.className.split(/\s+/).filter(k => k && !keys.includes(k)).join(' '); },
        toggle(k, on) { const want = on ?? !this.contains(k); if (want) this.add(k); else this.remove(k); return want; },
      };
    }
    appendChild(e) { e.parentElement = this; this.children.push(e); return e; }
    contains(e) { return e === this || this.children.some(n => n.contains(e)); }
    querySelectorAll(s) { return this.children.flatMap(n => [...(matches(n, s) ? [n] : []), ...n.querySelectorAll(s)]); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
    dispatch(t, extra = {}) {
      const event = { type: t, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of this.listeners[t] || []) fn.call(this, event);
      return event;
    }
    click() {
      if (this.disabled) return;
      if (this.type === 'checkbox') this.checked = !this.checked;
      if (this.type === 'radio') { for (const radio of body.querySelectorAll('input[type="radio"]')) if (radio.getAttribute('name') === this.getAttribute('name')) radio.checked = radio === this; }
      this.dispatch('click');
      if (this.type === 'checkbox' || this.type === 'radio') this.dispatch('change');
    }
    focus() { doc.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element();
  widget.className = 'tool-widget'; body.appendChild(widget);
  const escapeHTML = value => String(value).replaceAll('&', '&amp;').replaceAll('\"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0]
    .replace(/<Toggletip\b[\s\S]*?<\/Toggletip>/g, '')
    .replace(/=\{T\.(\w+)\}/g, (_, key) => '=\"' + escapeHTML(strings[lang][key]) + '\"')
    .replace(/\{T\.(\w+)\}/g, (_, key) => escapeHTML(strings[lang][key]));
  const stack = [widget], voids = new Set(['input', 'br', 'hr', 'img']);
  for (const token of markup.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (token[0].startsWith('<!--')) continue;
    if (token[3] !== undefined) { stack.at(-1).textContent += token[3].trim(); continue; }
    const tag = token[1];
    if (token[0].startsWith('</')) {
      if (stack.at(-1)?.tagName !== tag.toUpperCase()) throw new Error('Markup nesting mismatch ' + tag);
      stack.pop(); continue;
    }
    const e = new Element(tag);
    for (const attr of token[2].matchAll(/([\w-]+)(?:\s*=\s*"([^"]*)")?/g)) e.setAttribute(attr[1], attr[2] ?? '');
    stack.at(-1).appendChild(e);
    if (e.id) ids.set(e.id, e);
    if (!voids.has(tag) && !token[2].endsWith('/')) stack.push(e);
  }
  const get = id => { if (!ids.has(id)) throw new Error('Missing actual ID ' + id); return ids.get(id); };
  Object.assign(doc, {
    body, activeElement: body, getElementById: get,
    querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s),
    addEventListener(t, fn) { (docEvents[t] ??= []).push(fn); },
    dispatch(t, extra) {
      const e = { type: t, target: this.activeElement, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of docEvents[t] || []) fn.call(this, e);
      return e;
    },
  });
  const context = {
    document: doc, console, _slug: SLUG,
    t: JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(strings[lang]).filter(([key]) => key !== 'tips')))),
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    trackTool: (slug, action) => tracked.push({slug, action}),
    ztPersist: { clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) {
      let resolve, reject;
      const promise = new Promise((a, b) => { resolve = a; reject = b; });
      copies.push({ value, resolve, reject }); return promise;
    } } },
    setTimeout(fn, ms = 0) { const id = ++timerId; timers.set(id, { fn, due: now + ms, delay: ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1], context, { filename: SLUG + '.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return {
    doc, body, get, copies, clears, timers, context, tracked,
    input(id, value, type = 'input') { get(id).value = value; get(id).dispatch(type); },
    key(focus, { key = 'l', ctrlKey = true, metaKey = false } = {}) {
      (typeof focus === 'string' ? get(focus) : focus || body).focus();
      return doc.dispatch('keydown', { key, ctrlKey, metaKey });
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].due; next[1].fn();
      }
      now = until;
    },
  };
}

// Frozen pre-fix localized formatter results for 0 / 1 / 2, independent of current STRINGS.
const messages = {
  "en": {
    "removedDup": [
      "Removed 0 duplicates.",
      "Removed 1 duplicate.",
      "Removed 2 duplicates."
    ],
    "uniqueLines": [
      "0 unique lines.",
      "1 unique line.",
      "2 unique lines."
    ],
    "sortedAlphaAsc": [
      "Sorted 0 lines alphabetically (A→Z).",
      "Sorted 1 line alphabetically (A→Z).",
      "Sorted 2 lines alphabetically (A→Z)."
    ],
    "sortedAlphaDesc": [
      "Sorted 0 lines reverse alphabetically (Z→A).",
      "Sorted 1 line reverse alphabetically (Z→A).",
      "Sorted 2 lines reverse alphabetically (Z→A)."
    ],
    "sortedNum": [
      "Sorted 0 lines numerically.",
      "Sorted 1 line numerically.",
      "Sorted 2 lines numerically."
    ],
    "reversed": [
      "Reversed 0 lines.",
      "Reversed 1 line.",
      "Reversed 2 lines."
    ],
    "shuffled": [
      "Shuffled 0 lines.",
      "Shuffled 1 line.",
      "Shuffled 2 lines."
    ],
    "trimmed": [
      "Trimmed whitespace from 0 lines.",
      "Trimmed whitespace from 1 line.",
      "Trimmed whitespace from 2 lines."
    ],
    "removedEmpty": [
      "Removed 0 empty lines.",
      "Removed 1 empty line.",
      "Removed 2 empty lines."
    ],
    "remaining": [
      "0 lines remaining.",
      "1 line remaining.",
      "2 lines remaining."
    ],
    "lineCount": [
      "0 lines",
      "1 line",
      "2 lines"
    ]
  },
  "zh": {
    "removedDup": [
      "已删除 0 个重复行。",
      "已删除 1 个重复行。",
      "已删除 2 个重复行。"
    ],
    "uniqueLines": [
      "0 个唯一行。",
      "1 个唯一行。",
      "2 个唯一行。"
    ],
    "sortedAlphaAsc": [
      "已将 0 行按字母升序（A→Z）排序。",
      "已将 1 行按字母升序（A→Z）排序。",
      "已将 2 行按字母升序（A→Z）排序。"
    ],
    "sortedAlphaDesc": [
      "已将 0 行按字母降序（Z→A）排序。",
      "已将 1 行按字母降序（Z→A）排序。",
      "已将 2 行按字母降序（Z→A）排序。"
    ],
    "sortedNum": [
      "已将 0 行按数值排序。",
      "已将 1 行按数值排序。",
      "已将 2 行按数值排序。"
    ],
    "reversed": [
      "已反转 0 行。",
      "已反转 1 行。",
      "已反转 2 行。"
    ],
    "shuffled": [
      "已随机排序 0 行。",
      "已随机排序 1 行。",
      "已随机排序 2 行。"
    ],
    "trimmed": [
      "已去除 0 行的首尾空格。",
      "已去除 1 行的首尾空格。",
      "已去除 2 行的首尾空格。"
    ],
    "removedEmpty": [
      "已删除 0 个空行。",
      "已删除 1 个空行。",
      "已删除 2 个空行。"
    ],
    "remaining": [
      "剩余 0 行。",
      "剩余 1 行。",
      "剩余 2 行。"
    ],
    "lineCount": [
      "0 行",
      "1 行",
      "2 行"
    ]
  },
  "ja": {
    "removedDup": [
      "重複 0 行を削除しました。",
      "重複 1 行を削除しました。",
      "重複 2 行を削除しました。"
    ],
    "uniqueLines": [
      "0 行（ユニーク）。",
      "1 行（ユニーク）。",
      "2 行（ユニーク）。"
    ],
    "sortedAlphaAsc": [
      "0 行をアルファベット昇順（A→Z）に並び替えました。",
      "1 行をアルファベット昇順（A→Z）に並び替えました。",
      "2 行をアルファベット昇順（A→Z）に並び替えました。"
    ],
    "sortedAlphaDesc": [
      "0 行をアルファベット降順（Z→A）に並び替えました。",
      "1 行をアルファベット降順（Z→A）に並び替えました。",
      "2 行をアルファベット降順（Z→A）に並び替えました。"
    ],
    "sortedNum": [
      "0 行を数値順に並び替えました。",
      "1 行を数値順に並び替えました。",
      "2 行を数値順に並び替えました。"
    ],
    "reversed": [
      "0 行を逆順にしました。",
      "1 行を逆順にしました。",
      "2 行を逆順にしました。"
    ],
    "shuffled": [
      "0 行をシャッフルしました。",
      "1 行をシャッフルしました。",
      "2 行をシャッフルしました。"
    ],
    "trimmed": [
      "0 行の空白をトリムしました。",
      "1 行の空白をトリムしました。",
      "2 行の空白をトリムしました。"
    ],
    "removedEmpty": [
      "空行 0 行を削除しました。",
      "空行 1 行を削除しました。",
      "空行 2 行を削除しました。"
    ],
    "remaining": [
      "残り 0 行。",
      "残り 1 行。",
      "残り 2 行。"
    ],
    "lineCount": [
      "0 行",
      "1 行",
      "2 行"
    ]
  },
  "ko": {
    "removedDup": [
      "중복 0개를 제거했습니다.",
      "중복 1개를 제거했습니다.",
      "중복 2개를 제거했습니다."
    ],
    "uniqueLines": [
      "고유 줄 0개.",
      "고유 줄 1개.",
      "고유 줄 2개."
    ],
    "sortedAlphaAsc": [
      "0줄을 알파벳 오름차순(A→Z)으로 정렬했습니다.",
      "1줄을 알파벳 오름차순(A→Z)으로 정렬했습니다.",
      "2줄을 알파벳 오름차순(A→Z)으로 정렬했습니다."
    ],
    "sortedAlphaDesc": [
      "0줄을 알파벳 내림차순(Z→A)으로 정렬했습니다.",
      "1줄을 알파벳 내림차순(Z→A)으로 정렬했습니다.",
      "2줄을 알파벳 내림차순(Z→A)으로 정렬했습니다."
    ],
    "sortedNum": [
      "0줄을 숫자 순으로 정렬했습니다.",
      "1줄을 숫자 순으로 정렬했습니다.",
      "2줄을 숫자 순으로 정렬했습니다."
    ],
    "reversed": [
      "0줄을 역순으로 뒤집었습니다.",
      "1줄을 역순으로 뒤집었습니다.",
      "2줄을 역순으로 뒤집었습니다."
    ],
    "shuffled": [
      "0줄을 섞었습니다.",
      "1줄을 섞었습니다.",
      "2줄을 섞었습니다."
    ],
    "trimmed": [
      "0줄의 공백을 제거했습니다.",
      "1줄의 공백을 제거했습니다.",
      "2줄의 공백을 제거했습니다."
    ],
    "removedEmpty": [
      "빈 줄 0개를 제거했습니다.",
      "빈 줄 1개를 제거했습니다.",
      "빈 줄 2개를 제거했습니다."
    ],
    "remaining": [
      "남은 줄 0개.",
      "남은 줄 1개.",
      "남은 줄 2개."
    ],
    "lineCount": [
      "0줄",
      "1줄",
      "2줄"
    ]
  }
};
const languages = ['en', 'zh', 'ja', 'ko'];
const labels = {
  en: {copy:'Copy',copied:'Copied!',failure:'Could not copy. Please select and copy the output manually.'},
  zh: {copy:'复制',copied:'已复制！',failure:'复制失败。请选中输出内容后手动复制。'},
  ja: {copy:'コピー',copied:'コピー済み！',failure:'コピーできませんでした。出力を選択して手動でコピーしてください。'},
  ko: {copy:'복사',copied:'복사됨!',failure:'복사하지 못했습니다. 출력을 선택하여 직접 복사하세요.'},
};
const actions = [
  ['dedup','deduplicate',null,'z\na'],
  ['sort-asc','sort_asc','sortedAlphaAsc','a\nz'],
  ['sort-desc','sort_desc','sortedAlphaDesc','z\na'],
  ['sort-num','sort_numeric','sortedNum','a\nz'],
  ['reverse','reverse','reversed','a\nz'],
  ['shuffle','shuffle','shuffled','a\nz'],
  ['trim','trim','trimmed','z\na'],
  ['empty','remove_empty',null,'z\na'],
];
const snapshot = p => ({
  input:p.get('lt-input').value, output:p.get('lt-output').value,
  count:p.get('lt-count').textContent, status:p.get('lt-status').textContent,
  statusClass:p.get('lt-status').className, copy:p.get('lt-copy').textContent,
});
function input(p, value) { p.input('lt-input', value); }
function run(p, action='dedup', value='z\na\nz') { input(p,value); p.get('lt-'+action).click(); }
function copy(p) { p.get('lt-copy').click(); return p.copies.at(-1); }
function boundary(p, name) {
  if(name==='clear') p.get('lt-clear').click();
  else if(name==='ctrlL') p.key('lt-input');
  else if(name==='new-input') input(p,'new input\nwith two lines');
  else p.get('lt-'+name).click();
}
const boundaries = ['clear','ctrlL','new-input',...actions.map(a=>a[0])];

for(const lang of languages) {
  const M=messages[lang], T=labels[lang];
  for(const [action,event,message,double] of actions) for(const n of [1,2]) {
    const p=page(lang); const value=n===1?'z':'z\na'; input(p,value);
    check(`${lang}/${action}/${n}: input only updates count`,snapshot(p).output,'');
    check(`${lang}/${action}/${n}: count language`,snapshot(p).count,M.lineCount[n]);
    p.get('lt-'+action).click();
    check(`${lang}/${action}/${n}: actual manual output`,snapshot(p).output,n===1?'z':double);
    check(`${lang}/${action}/${n}: original input retained`,snapshot(p).input,value);
    const status=action==='dedup'?M.removedDup[0]+' '+M.uniqueLines[n]:action==='empty'?M.removedEmpty[0]+' '+M.remaining[n]:M[message][n];
    check(`${lang}/${action}/${n}: original localized status`,snapshot(p).status,status);
    check(`${lang}/${action}/${n}: one original tracking event`,JSON.parse(JSON.stringify(p.tracked)),[{slug:'line_tools',action:event}]);
    input(p,''); check(`${lang}/${action}/${n}: editing alone retains previous manual output`,snapshot(p).output,n===1?'z':double);
    p.get('lt-'+action).click();
    check(`${lang}/${action}/${n}: empty action clears output and status`,[snapshot(p).output,snapshot(p).status,snapshot(p).count],['','','']);
  }
  {
    const p=page(lang);run(p,'dedup','a\na');check(lang+': one duplicate preserves localized singular',[snapshot(p).output,snapshot(p).status],['a',M.removedDup[1]+' '+M.uniqueLines[1]]);
    run(p,'empty','a\n ');check(lang+': one empty line preserves localized singular',[snapshot(p).output,snapshot(p).status],['a',M.removedEmpty[1]+' '+M.remaining[1]]);
    run(p,'empty','\n');check(lang+': all empty lines report zero remaining',[snapshot(p).output,snapshot(p).status],['',M.removedEmpty[2]+' '+M.remaining[0]]);
    run(p,'trim','  a \n\tb\t\n');check(lang+': trim preserves empty lines',snapshot(p).output,'a\nb\n');
    run(p,'empty','  a \n\t\nb\n');check(lang+': removing empty keeps retained whitespace',snapshot(p).output,'  a \nb');
    run(p,'sort-num','10 apples\n-2\n1.5\n0.25\nword\nanother\n3tail');
    check(lang+': numeric prefixes fractions negatives and NaN order',snapshot(p).output,'-2\n0.25\n1.5\n3tail\n10 apples\nanother\nword');
    run(p,'reverse','a\nb\n');check(lang+': reverse retains trailing empty line',snapshot(p).output,'\nb\na');
    run(p,'shuffle','a\nb\nc\nd');check(lang+': original Fisher-Yates with zero random draws',snapshot(p).output,'b\nc\nd\na');
    for(const value of ['hasOwnProperty\nx','__proto__\n__proto__\nx','constructor\nconstructor\nx','toString\ntoString\nx']) {
      run(p,'dedup','old\nold');input(p,value);let error=null;try{p.get('lt-dedup').click();}catch(e){error=e.message;}
      check(lang+': special key does not throw '+value,error,null);
      const want=value==='hasOwnProperty\nx'?'hasOwnProperty\nx':value.split('\n')[0]+'\nx';
      check(lang+': special key ordinary dedup '+value,snapshot(p).output,want);
    }
    run(p,'dedup',' a\na\n a\n');check(lang+': dedup remains exact and preserves first occurrence/blank',snapshot(p).output,' a\na\n');
  }
  for(const shellFirst of [false,true]) for(const focus of ['lt-input','lt-output','lt-copy']) for(const key of ['l','L']) for(const meta of [false,true]) {
    const p=page(lang,shellFirst);run(p);const e=p.key(focus,{key,ctrlKey:!meta,metaKey:meta});
    check(`${lang}: clear fields/count/status ${shellFirst}/${focus}/${key}/${meta}`,snapshot(p),{input:'',output:'',count:'',status:'',statusClass:'lt-status',copy:T.copy});
    check(lang+': shortcut native default prevented',e.defaultPrevented);
    check(lang+': shared persistence clear once',p.clears,['line-tools']);
  }
  {
    const p=page(lang);run(p);const before=snapshot(p);
    p.key(p.body);check(lang+': outside CtrlL untouched',snapshot(p),before);
    p.key('lt-input',{ctrlKey:false,key:'l'});check(lang+': ordinary L untouched',snapshot(p),before);
    p.key('lt-input',{key:'Enter'});check(lang+': CtrlEnter has no manual action',snapshot(p),before);
    p.get('lt-clear').click();check(lang+': Clear positive control',snapshot(p),{input:'',output:'',count:'',status:'',statusClass:'lt-status',copy:T.copy});
    const count=p.copies.length;copy(p);check(lang+': empty result never invokes clipboard',p.copies.length,count);
  }
  {
    const p=page(lang);run(p,'dedup','世界\nhello\n世界');const job=copy(p);
    check(lang+': exact full copy bytes',job.value,'世界\nhello');job.resolve();await settle();
    check(lang+': current successful copy',snapshot(p).copy,T.copied);
    p.advance(1499);check(lang+': copy feedback lasts 1500ms',snapshot(p).copy,T.copied);
    p.advance(1);check(lang+': copy feedback expires',snapshot(p).copy,T.copy);
  }
  for(const kind of ['reject','throw','missing']) {
    const p=page(lang);run(p);const clipboard=p.context.navigator.clipboard;let error=null;const start=unhandled.length;
    if(kind==='throw')p.context.navigator.clipboard={writeText(){throw new Error('blocked');}};
    if(kind==='missing')p.context.navigator.clipboard=undefined;
    try{const job=copy(p);if(kind==='reject')job.reject(new Error('denied'));}catch(e){error=e.message;}
    await settle();check(lang+': '+kind+' handled synchronously',error,null);check(lang+': '+kind+' handled promise',unhandled.slice(start),[]);
    check(lang+': '+kind+' localized visible failure',[snapshot(p).status,snapshot(p).statusClass,snapshot(p).copy],[T.failure,'lt-status error',T.copy]);
    p.context.navigator.clipboard=clipboard;const before=snapshot(p).output;const retry=copy(p);retry.resolve();await settle();
    check(lang+': '+kind+' same-result direct retry clears own error',[retry.value,snapshot(p).output,snapshot(p).status,snapshot(p).copy],[before,before,'',T.copied]);
  }
  for(const name of boundaries) for(const order of name==='ctrlL'?[false,true]:[false]) for(const outcome of ['resolve','reject']) {
    const p=page(lang,order);run(p);const job=copy(p);boundary(p,name);const before=snapshot(p),start=unhandled.length;
    job[outcome](outcome==='reject'?new Error('late denied'):undefined);await settle();
    check(`${lang}: late ${outcome} after ${name}/${order} preserves current state`,snapshot(p),before);
    check(`${lang}: late ${outcome} after ${name}/${order} has no unhandled rejection`,unhandled.slice(start),[]);
  }
  for(const name of boundaries) {
    const p=page(lang);run(p);copy(p).resolve();await settle();const oldTimer=[...p.timers.values()].find(t=>t.delay===1500);
    check(lang+': feedback timer exists for '+name,!!oldTimer);boundary(p,name);
    check(lang+': '+name+' resets old successful copy feedback',snapshot(p).copy,T.copy);
    const before=snapshot(p);oldTimer?.fn();check(lang+': queued timer after '+name+' cannot change state',snapshot(p),before);
  }
  {
    const p=page(lang);run(p);copy(p).resolve();await settle();const oldTimer=[...p.timers.values()].find(t=>t.delay===1500);
    p.advance(500);copy(p).resolve();await settle();oldTimer?.fn();check(lang+': queued old timer cannot reset newer copy',snapshot(p).copy,T.copied);
    p.advance(1000);check(lang+': old deadline keeps newer copy',snapshot(p).copy,T.copied);p.advance(500);check(lang+': latest timer expires normally',snapshot(p).copy,T.copy);
    const a=copy(p),b=copy(p);b.resolve();await settle();const success=snapshot(p);a.reject(new Error('older'));await settle();check(lang+': old rejection cannot replace newer success',snapshot(p),success);
    const c=copy(p),d=copy(p);d.reject(new Error('newer'));await settle();const failure=snapshot(p);c.resolve();await settle();check(lang+': old success cannot hide latest failure',snapshot(p),failure);
    const retry=copy(p);p.get('lt-sort-desc').click();const sorted=snapshot(p);retry.resolve();await settle();check(lang+': retry cannot clear newer operation status',snapshot(p),sorted);
    copy(p).resolve();await settle();check(lang+': successful copy keeps valid operation status',snapshot(p).status,sorted.status);
  }
}
check('all clipboard promises handled',unhandled,[]);
process.off('unhandledRejection',onUnhandled);

// ---------- v2 page layout ----------
{
  const beforePasses = passes, beforeFailures = failures;
  const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
  const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const tipKeys = ['input','dedup','sortAsc','sortDesc','sortNum','reverse','shuffle','trim','removeEmpty','copy'];
  const tipIDs = ['input','dedup','sort-asc','sort-desc','sort-num','reverse','shuffle','trim','empty','copy'].map(id=>'lt-tip-'+id);
  check('all ten tips bind explicit controls', [...markup.matchAll(/<Toggletip id="([^"]+)"/g)].map(m=>m[1]).sort(), tipIDs.slice().sort());
  check('direct tool flex root with zero minimum height', /^\s*<div class="lt-wrap">/.test(markup) && /\.lt-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0/.test(css));
  check('manual actions precede reserved status and panes', markup.indexOf('lt-actions') < markup.indexOf('id="lt-status"') && markup.indexOf('id="lt-status"') < markup.indexOf('lt-panels'));
  check('one shared convert grid', (markup.match(/\bzt-io"/g)||[]).length, 1);
  check('two shared panes', (markup.match(/\bzt-io-pane\b/g)||[]).length, 2);
  check('two fill editors', (markup.match(/\bzt-io-fill\b/g)||[]).length, 2);
  for(const [action] of actions) check(action+': original manual button remains', markup.includes('id="lt-'+action+'"'));
  check('Clear and Copy remain', markup.includes('id="lt-clear"') && markup.includes('id="lt-copy"'));
  check('no new primary/automatic action', !markup.includes('btn-primary'));
  check('readonly output is preserved', /<textarea[^>]*id="lt-output"[^>]*readonly/.test(markup));
  check('Copy and tips outside labels', [...markup.matchAll(/<label\b[\s\S]*?<\/label>/g)].every(m=>!/<button|<Toggletip/.test(m[0])));
  check('status has fixed height and internal overflow', /\.lt-status\s*\{[^}]*height: 2\.8em;[^}]*overflow: auto/.test(css));
  check('editors internally scroll', /\.lt-box\s*\{[^}]*overflow: auto/.test(css));
  check('860 breakpoint hides empty output only', /@media \(max-width: 860px\)\s*\{\s*\.lt-output-pane\[data-empty="true"\]\s*\{\s*display: none/.test(css));
  check('640 compact two-column controls have touch height', /@media \(max-width: 640px\)/.test(css) && css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))') && /min-height: 44px/.test(css));
  check('mobile status reserves three lines', /\.lt-status\s*\{\s*height: 4\.2em/.test(css));
  check('mobile controls override shared actions flex', css.includes('.lt-wrap .lt-actions .btn-secondary') && css.includes('.lt-wrap .lt-action .btn-secondary'));
  check('hidden wins display', /\.lt-wrap \[hidden\]\s*\{\s*display: none/.test(css));
  check('static labels built without runtime language replacement', !/data-i18n|document\.documentElement\.lang|var STRINGS/.test(source));
  check('script serializes client strings only', /const \{ tips: TIPS, \.\.\.CLIENT_T \} = T;/.test(source) && /define:vars=\{\{ t: CLIENT_T \}\}/.test(source));
  check('registered as convert', /'line-tools':\s*'convert'/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));
  const ids=[...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);check('all IDs unique',new Set(ids).size,ids.length);
  for(const lang of languages) {
    const T=strings[lang],{tips,...client}=T;
    check(lang+': all translation keys match',Object.keys(T).sort(),Object.keys(strings.en).sort());
    check(lang+': all tip keys match actual controls',Object.keys(tips).sort(),tipKeys.slice().sort());
    for(const key of tipKeys) check(lang+'/'+key+': nonempty plain tip',typeof tips[key]==='string' && tips[key].trim().length>0 && !/[\n<>]/.test(tips[key]));
    check(lang+': client contains no tips',!('tips' in client) && Object.values(tips).every(tip=>!JSON.stringify(client).includes(JSON.stringify(tip))));
    check(lang+': serializable count templates survive client JSON', JSON.parse(JSON.stringify(client)), JSON.parse(JSON.stringify(T, (key,value)=>key==='tips'?undefined:value)));
    for(const [key,wants] of Object.entries(messages[lang])) for(const n of [0,1,2]) {
      check(lang+'/'+key+'/'+n+': original count/plural text preserved',client[key][n===1?'one':'other'].replace('{n}',String(n)),wants[n]);
    }
    const mdx=readFileSync(join(root,'src/content/tools/line-tools',lang+'.mdx'),'utf8');
    const at=mdx.indexOf('\n---\n',4),meta=mdx.slice(0,at),body=mdx.slice(at+5),{steps}=loadYaml(meta.slice(4));
    check(lang+': six steps fit limits',steps.length===6 && steps.every(step=>typeof step==='string' && step.length<=280 && !/<[^>]*>/.test(step)) && steps.join('').length<=1200);
    for(const key of ['inputLines','output','dedup','sortAsc','sortDesc','sortNum','reverse','shuffle','trim','removeEmpty','copy','clear']) check(lang+': steps name '+key,steps.some(step=>step.includes(T[key])));
    check(lang+': MDX content contract', contractProblems('line-tools', lang), '');
    check(lang+': Usage removed',!/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
    const p=page(lang);check(lang+': empty output hidden flag',p.get('lt-output-pane').getAttribute('data-empty'),'true');
    input(p,'z\na');check(lang+': editing keeps output empty',p.get('lt-output-pane').getAttribute('data-empty'),'true');
    p.get('lt-dedup').click();check(lang+': manual output visible flag',p.get('lt-output-pane').getAttribute('data-empty'),'false');
    input(p,'');p.get('lt-sort-asc').click();check(lang+': empty manual action hides output flag',p.get('lt-output-pane').getAttribute('data-empty'),'true');
    run(p,'empty','\n');check(lang+': all-removed output empty flag',p.get('lt-output-pane').getAttribute('data-empty'),'true');
    run(p);p.get('lt-clear').click();check(lang+': Clear restores empty output flag',p.get('lt-output-pane').getAttribute('data-empty'),'true');
    run(p);p.key('lt-input');check(lang+': CtrlL restores empty output flag',p.get('lt-output-pane').getAttribute('data-empty'),'true');
  }
  const require=createRequire(import.meta.url);
  const {transform}=await import(require.resolve('@astrojs/compiler',{paths:[dirname(require.resolve('astro'))]}));
  const {transform:parseJs}=await import('esbuild');
  const compiled=await transform(source,{filename:'LineToolsTool.astro'});
  check('Astro compilation reports no errors',compiled.diagnostics.filter(d=>d.severity===1).length,0);
  await parseJs(compiled.code,{loader:'ts',format:'esm'});
  check('compiled JavaScript parses and uses CLIENT_T',compiled.code.includes('$$defineScriptVars({ t: CLIENT_T })'));
  console.log('v2 page layout: '+(passes-beforePasses)+' passed, '+(failures-beforeFailures)+' failed');
}

console.log(`${passes} passed, ${failures} failed`);
process.exitCode=failures?1:0;
