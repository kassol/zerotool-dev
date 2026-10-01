// HTML to JSX — attribute names converted, attribute values kept; event handlers become functions
//
// Read:  src/components/tools/HtmlToJsxTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: attribute values are copied as written (the words class / for / style / onclick
// inside a value are not renamed; this is what htmltojsx does: it maps the attribute name
// only and copies the value), single / double / unquoted values, boolean attributes, `>` and
// `/` inside quoted values, inline style to object, on* attributes renamed to the React name
// (onMouseOver, onDoubleClick, onKeyDown ...) and their code wrapped in an arrow function with
// entities decoded (React throws on a string listener), void and self-closing tags, comments
// (a */ inside is written as * /); the HTML attribute names from react-dom possibleStandardNames.js
// (autocomplete, srcset, novalidate ... were copied lowercase and made React warn); the English page
// login form example.
//
// Run: node scripts/test-html-to-jsx.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/HtmlToJsxTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in HtmlToJsxTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { htmlToJsx };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}
const jsx = (html) => E.htmlToJsx(html);

// ---------- the reported defect: values rewritten ----------
eq('for / class inside a URL value are kept',
  jsx('<a href="/search?for=1&class=2">x</a>'),
  '<a href="/search?for=1&class=2">x</a>');
eq('attribute words inside title / alt are kept',
  jsx('<img alt="class for tabindex" title="style=red onclick=x">'),
  '<img alt="class for tabindex" title="style=red onclick=x" />');
eq('style= inside another value is not converted',
  jsx('<div data-x="style=color:red">x</div>'),
  '<div data-x="style=color:red">x</div>');
eq('names are still converted', jsx('<label for="a" class="b" tabindex="0">x</label>'),
  '<label htmlFor="a" className="b" tabIndex="0">x</label>');
eq('names are case-insensitive', jsx('<div CLASS="a" ReadOnly>x</div>'), '<div className="a" readOnly>x</div>');
eq('data-for / aria-* names untouched', jsx('<b data-for="x" aria-label="for">y</b>'),
  '<b data-for="x" aria-label="for">y</b>');

// ---------- the reported defect: event handlers output as strings ----------
eq('onclick → onClick arrow function',
  jsx('<button onclick="save()">Save</button>'),
  '<button onClick={(event) => { save() }}>Save</button>');
eq('onmouseover → onMouseOver', jsx('<div onmouseover="hi()">x</div>'),
  '<div onMouseOver={(event) => { hi() }}>x</div>');
eq('ondblclick → onDoubleClick', jsx('<div ondblclick="a()">x</div>'),
  '<div onDoubleClick={(event) => { a() }}>x</div>');
eq('onkeydown → onKeyDown', jsx('<input onkeydown="k(event)">'),
  '<input onKeyDown={(event) => { k(event) }} />');
eq('ONCHANGE upper case', jsx('<select ONCHANGE="c()"></select>'),
  '<select onChange={(event) => { c() }}></select>');
eq('entities in handler code decoded',
  jsx('<button onclick="alert(&quot;a &amp; b&quot;)">x</button>'),
  '<button onClick={(event) => { alert("a & b") }}>x</button>');
eq('single-quoted handler with double quotes',
  jsx('<a onclick=\'go("x"); return false;\'>x</a>'),
  '<a onClick={(event) => { go("x"); return false; }}>x</a>');
eq('empty handler', jsx('<a onclick="">x</a>'), '<a onClick={(event) => {}}>x</a>');
eq('handler with // comment closes on a new line', jsx('<a onclick="go() // note">x</a>'),
  '<a onClick={(event) => { go() // note\n}}>x</a>');
eq('> inside a quoted handler does not end the tag',
  jsx('<button onclick="if (a > b) go()">x</button>'),
  '<button onClick={(event) => { if (a > b) go() }}>x</button>');
eq('on* name that is not a DOM event is kept as written', jsx('<x-el onfoo="f()"></x-el>'),
  '<x-el onfoo="f()"></x-el>');
eq('name that only starts with "on" letters', jsx('<input one="1">'), '<input one="1" />');

// ---------- values: quoting ----------
eq('single quotes kept', jsx("<a title='say \"hi\"'>x</a>"), "<a title='say \"hi\"'>x</a>");
eq('unquoted value gets double quotes', jsx('<td colspan=2>x</td>'), '<td colSpan="2">x</td>');
eq('boolean attribute kept', jsx('<input disabled required>'), '<input disabled required />');
eq('entities in plain values kept', jsx('<a title="&lt;b&gt;">x</a>'), '<a title="&lt;b&gt;">x</a>');
eq('spaces around = removed', jsx('<a href = "/x">x</a>'), '<a href="/x">x</a>');
eq('multi-line attributes keep their line breaks',
  jsx('<div\n  class="a"\n  id="b">x</div>'), '<div\n  className="a"\n  id="b">x</div>');
eq('Object.prototype names are not looked up', jsx('<x-a constructor="c" tostring>x</x-a>'),
  '<x-a constructor="c" tostring>x</x-a>');

// ---------- style ----------
eq('style → object', jsx('<div style="color: red; font-size: 14px">x</div>'),
  "<div style={{ color: 'red', fontSize: '14px' }}>x</div>");
eq('style with url quotes', jsx('<div style="background-image: url(\'a.png\')">x</div>'),
  "<div style={{ backgroundImage: 'url(\\'a.png\\')' }}>x</div>");
eq('style single-quoted', jsx("<p style='margin:0'>x</p>"), "<p style={{ margin: '0' }}>x</p>");
eq('style entities decoded', jsx('<p style="font-family: &quot;Inter&quot;">x</p>'),
  "<p style={{ fontFamily: '\"Inter\"' }}>x</p>");

// ---------- tags ----------
eq('void tag self-closed', jsx('<br>'), '<br />');
eq('already self-closed void tag', jsx('<br/>'), '<br />');
eq('self-closing with attrs', jsx('<img src="a.png" />'), '<img src="a.png" />');
eq('slash inside a quoted value is not a self-close', jsx('<a href="/x/">x</a>'), '<a href="/x/">x</a>');
eq('closing tags untouched', jsx('<p>a</p>'), '<p>a</p>');
eq('comment', jsx('<!-- footer -->'), '{/* footer */}');
eq('text containing class= is untouched', jsx('<p>class="x" for="y"</p>'), '<p>class="x" for="y"</p>');
eq('page example',
  jsx('<label for="email" class="lbl">Email</label>\n<input id="email" type="email" required>\n<div style="background-image: url(\'a.png\'); font-size:14px">x</div>\n<!-- footer -->'),
  '<label htmlFor="email" className="lbl">Email</label>\n<input id="email" type="email" required />\n<div style={{ backgroundImage: \'url(\\\'a.png\\\')\', fontSize: \'14px\' }}>x</div>\n{/* footer */}');

// ---------- more attribute names (react-dom possibleStandardNames.js) ----------
for (const [html, react] of [
  ['accept-charset', 'acceptCharset'], ['autocapitalize', 'autoCapitalize'], ['autocomplete', 'autoComplete'],
  ['autoplay', 'autoPlay'], ['cellpadding', 'cellPadding'], ['cellspacing', 'cellSpacing'], ['charset', 'charSet'],
  ['controlslist', 'controlsList'], ['datetime', 'dateTime'], ['enterkeyhint', 'enterKeyHint'],
  ['fetchpriority', 'fetchPriority'], ['formaction', 'formAction'], ['formenctype', 'formEncType'],
  ['formmethod', 'formMethod'], ['formnovalidate', 'formNoValidate'], ['formtarget', 'formTarget'],
  ['hreflang', 'hrefLang'], ['http-equiv', 'httpEquiv'], ['inputmode', 'inputMode'], ['itemprop', 'itemProp'],
  ['itemscope', 'itemScope'], ['itemtype', 'itemType'], ['nomodule', 'noModule'], ['novalidate', 'noValidate'],
  ['playsinline', 'playsInline'], ['popovertarget', 'popoverTarget'], ['referrerpolicy', 'referrerPolicy'],
  ['spellcheck', 'spellCheck'], ['srcdoc', 'srcDoc'], ['srclang', 'srcLang'], ['srcset', 'srcSet'],
]) {
  eq('rename ' + html, jsx('<x ' + html + '="v">'), '<x ' + react + '="v">');
  eq('rename upper-case ' + html, jsx('<x ' + html.toUpperCase() + '>'), '<x ' + react + '>');
}
eq('comment containing */', jsx('<!-- a */ b -->'), '{/* a * / b */}');

// ---------- English page login form ----------
{
  const page = readFileSync(join(root, 'src/content/tools/html-to-jsx/en.mdx'), 'utf8');
  const input = '<form action="/login" method="post" novalidate>\n  <label for="user" class="field-label">Username</label>\n  <input id="user" name="user" autocomplete="username" maxlength="32" autofocus>\n  <button type="submit" onclick="track(&quot;login&quot;)">Sign in</button>\n</form>';
  const out = jsx(input);
  eq('login form output', out, '<form action="/login" method="post" noValidate>\n  <label htmlFor="user" className="field-label">Username</label>\n  <input id="user" name="user" autoComplete="username" maxLength="32" autoFocus />\n  <button type="submit" onClick={(event) => { track("login") }}>Sign in</button>\n</form>');
  check('page shows the login input', page.includes(input));
  check('page shows the login output', page.includes(out));
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
