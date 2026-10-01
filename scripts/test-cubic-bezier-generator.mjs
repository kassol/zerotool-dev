// Cubic Bezier Generator — preset values and labels name the system and version they come from
//
// Read:  src/components/tools/CubicBezierGeneratorTool.astro (preset buttons and the 4-language
//        label table in the frontmatter); src/content/tools/cubic-bezier-generator/*.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers the reported defect: the "Material" presets are the Material Design 2 curves but were not
// labelled with a version (Material 3's standard curve is (0.2, 0, 0, 1)), and "iOS Default"
// (0.25, 0.1, 0.25, 1) is Core Animation's `.default` timing function, not the UIView animation
// default. Expected values are typed from the sources: CSS Easing Functions Level 1 §2.2 (keywords),
// Material Design 2 "Speed" (standard / decelerate / accelerate), Material 3 easing tokens
// (md.sys.motion.easing.standard), Apple CAMediaTimingFunctionName.default, Tailwind CSS
// `--ease-in-out`. Also: every preset button has a label in all 4 languages, and every
// cubic-bezier(...) on the tool pages that is called "Material standard" uses the M2 value
// or says M3.
//
// Run: node scripts/test-cubic-bezier-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CubicBezierGeneratorTool.astro'), 'utf8');

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

const buttons = [...source.matchAll(/<button class="cbg-preset" data-p="([^"]+)" type="button">\{L\.(\w+)\}<\/button>/g)]
  .map((m) => ({ p: m[1], key: m[2] }));
const byKey = Object.fromEntries(buttons.map((b) => [b.key, b.p]));
const labels = {};
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const m = source.match(new RegExp('\\n  ' + lang + ': \\{([\\s\\S]*?)\\n  \\}'));
  labels[lang] = m ? Object.fromEntries([...m[1].matchAll(/\n\s+(\w+): '((?:[^'\\]|\\.)*)'/g)].map((x) => [x[1], x[2]])) : {};
}

const EXPECTED = {
  presetLinear: '0,0,1,1',
  presetEase: '0.25,0.1,0.25,1',
  presetEaseIn: '0.42,0,1,1',
  presetEaseOut: '0,0,0.58,1',
  presetEaseInOut: '0.42,0,0.58,1',
  presetM2Std: '0.4,0,0.2,1',
  presetM2Decel: '0,0,0.2,1',
  presetM2Accel: '0.4,0,1,1',
  presetM3Std: '0.2,0,0,1',
  presetCaDefault: '0.25,0.1,0.25,1',
  presetTwInOut: '0.4,0,0.2,1',
  presetBack: '0.68,-0.55,0.265,1.55',
};
for (const [k, v] of Object.entries(EXPECTED)) eq('preset ' + k, byKey[k], v);
check('no unversioned Material preset keys', !buttons.some((b) => /^presetMat/.test(b.key)), buttons.map((b) => b.key).join(','));
check('no "iOS" preset', !buttons.some((b) => /Ios/.test(b.key)));

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  for (const b of buttons) check(lang + ' label for ' + b.key, typeof labels[lang][b.key] === 'string' && labels[lang][b.key].length > 0);
  check(lang + ' M2 labels say Material 2', ['presetM2Std', 'presetM2Decel', 'presetM2Accel'].every((k) => /Material 2|M2/.test(labels[lang][k] || '')));
  check(lang + ' M3 label says Material 3', /Material 3|M3/.test(labels[lang].presetM3Std || ''));
  check(lang + ' no label says iOS', !Object.values(labels[lang]).some((v) => /iOS/.test(v)));
}

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/cubic-bezier-generator', lang + '.mdx'), 'utf8');
  check(lang + ' page: (0.4, 0, 0.2, 1) is labelled Material 2 where Material is named',
    !/0\.4, 0, 0\.2, 1\)<\/code>\s*[（(]Material (standard|標準|标准|표준)/.test(mdx));
  check(lang + ' page: no "iOS natural ease" claim', !/iOS's natural ease|iOS のナチュラル|iOS 自然|iOS 자연/.test(mdx));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
