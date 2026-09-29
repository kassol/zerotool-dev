// XML Formatter — prolog (XML declaration, DOCTYPE) preservation and DOM serialization regression test
//
// Read:  src/components/tools/XmlFormatterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Node has no DOMParser, so the tests build the node tree that the browser's DOMParser
// returns: the XML declaration is not a node, the DOCTYPE is a DocumentType node (nodeType 10)
// without its internal subset, comments and processing instructions are nodes.
//
// Covers: scanProlog (declaration with double / single quotes, encoding and standalone;
// xml-stylesheet is a PI and not the declaration; DOCTYPE with SYSTEM / PUBLIC ids; internal
// subset with ">" and "]" inside quoted literals, comments and PIs; comments and PIs before the
// DOCTYPE; no prolog); prettyPrint and minify keep the declaration and the DOCTYPE in document
// order, keep comments and PIs in the prolog, inside elements and after the root, and write a
// PI without data as <?target?>.
//
// Run: node scripts/test-xml-formatter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/XmlFormatterTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in XmlFormatterTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { scanProlog, prettyPrint, minify };')();

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

// ---------- DOM node builders (shape of DOMParser output) ----------
const doc = (...childNodes) => ({ nodeType: 9, childNodes });
const doctype = (name, publicId = '', systemId = '') => ({ nodeType: 10, name, publicId, systemId });
const el = (tagName, attrs, ...childNodes) => ({
  nodeType: 1, tagName, childNodes,
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
});
const text = (data) => ({ nodeType: 3, data });
const comment = (data) => ({ nodeType: 8, data });
const pi = (target, data) => ({ nodeType: 7, target, data });

// ---------- the reported defect: declaration and DOCTYPE are dropped ----------
const src1 = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE note SYSTEM "note.dtd">\n<note><to>Tove</to></note>';
const doc1 = doc(doctype('note', '', 'note.dtd'), el('note', {}, el('to', {}, text('Tove'))));
eq('format keeps declaration and DOCTYPE', E.prettyPrint(doc1, '  ', E.scanProlog(src1)),
  '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE note SYSTEM "note.dtd">\n<note>\n  <to>Tove</to>\n</note>');
eq('minify keeps declaration and DOCTYPE', E.minify(doc1, E.scanProlog(src1)),
  '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE note SYSTEM "note.dtd"><note><to>Tove</to></note>');

// ---------- scanProlog ----------
eq('declaration only', E.scanProlog('<?xml version="1.0"?><a/>'), { declaration: '<?xml version="1.0"?>', doctype: '' });
eq('single-quoted declaration with standalone', E.scanProlog("<?xml version='1.0' encoding='Shift_JIS' standalone='yes'?>\n<a/>").declaration,
  "<?xml version='1.0' encoding='Shift_JIS' standalone='yes'?>");
eq('no prolog', E.scanProlog('<a><b/></a>'), { declaration: '', doctype: '' });
eq('xml-stylesheet is not the declaration', E.scanProlog('<?xml-stylesheet type="text/xsl" href="s.xsl"?><a/>').declaration, '');
eq('PUBLIC DOCTYPE', E.scanProlog('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"><html/>').doctype,
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">');
const subset = '<!DOCTYPE doc [\n  <!ELEMENT doc (#PCDATA)>\n  <!ENTITY gt2 "a > b ]">\n  <!-- note: ] > -->\n  <?pi x > ] ?>\n  <!ATTLIST doc v CDATA \'1]>\'>\n]>';
eq('internal subset with > and ] in literals, comments and PIs', E.scanProlog('<?xml version="1.0"?>\n' + subset + '\n<doc/>').doctype, subset);
eq('comment and PI before DOCTYPE', E.scanProlog('<?xml version="1.0"?>\n<!-- head -->\n<?pi a?>\n<!DOCTYPE r>\n<r/>'),
  { declaration: '<?xml version="1.0"?>', doctype: '<!DOCTYPE r>' });
eq('comment mentioning <!DOCTYPE is skipped', E.scanProlog('<!-- <!DOCTYPE fake> --><r/>').doctype, '');
eq('DOCTYPE inside the root is not the prolog', E.scanProlog('<r><![CDATA[<!DOCTYPE x>]]></r>').doctype, '');

// ---------- DOCTYPE with internal subset, format ----------
const doc2 = doc(doctype('doc'), el('doc', {}, text('x')));
eq('format writes the internal subset verbatim', E.prettyPrint(doc2, '  ', E.scanProlog(subset + '<doc>x</doc>')), subset + '\n<doc>x</doc>');

// ---------- comments and processing instructions ----------
const src3 = '<?xml version="1.0"?>\n<?xml-stylesheet type="text/xsl" href="s.xsl"?>\n<!-- before -->\n<r><!-- in --><?go now?><a/></r>\n<!-- after -->';
const doc3 = doc(
  pi('xml-stylesheet', 'type="text/xsl" href="s.xsl"'),
  comment(' before '),
  el('r', {}, comment(' in '), pi('go', 'now'), el('a', {})),
  comment(' after '),
);
eq('format keeps prolog PI and comments in order', E.prettyPrint(doc3, '  ', E.scanProlog(src3)),
  '<?xml version="1.0"?>\n<?xml-stylesheet type="text/xsl" href="s.xsl"?>\n<!-- before -->\n<r>\n  <!-- in -->\n  <?go now?>\n  <a/>\n</r>\n<!-- after -->');
eq('minify keeps prolog PI and comments in order', E.minify(doc3, E.scanProlog(src3)),
  '<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="s.xsl"?><!-- before --><r><!-- in --><?go now?><a/></r><!-- after -->');
eq('PI without data', E.prettyPrint(doc(el('r', {}, pi('flush', ''))), '  ', E.scanProlog('<r><?flush?></r>')), '<r>\n  <?flush?>\n</r>');
eq('minify PI without data', E.minify(doc(el('r', {}, pi('flush', ''))), E.scanProlog('<r><?flush?></r>')), '<r><?flush?></r>');

// ---------- no prolog: output unchanged from before ----------
eq('no prolog format', E.prettyPrint(doc(el('root', { id: '1' }, el('name', {}, text('A & B')))), '\t', E.scanProlog('<root/>')),
  '<root id="1">\n\t<name>A &amp; B</name>\n</root>');

console.log((failures ? 'FAILED' : 'PASSED') + ': ' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
