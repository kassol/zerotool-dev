// Conversion fidelity — finds values that YAML ↔ TOML, TOML ↔ JSON and YAML ↔ JSON cannot
// write to the target format without changing them, so the page refuses the conversion and
// names each field instead of writing a changed value.
//
// Shared by YamlTomlTool, TomlJsonTool and YamlJsonTool (scripts/test-conversion-fidelity.mjs
// drives them through the page). Each finding:
// - Integers outside ±(2^53 − 1): JavaScript numbers round them (2^53 + 1 → 2^53), and the TOML
//   serializer writes ±2^53 as floats. YAML ints are caught in the js-yaml int type, JSON ints by
//   the JSON.parse source text (ES2025 JSON.parse source text access; without it, any integral
//   number beyond the range counts). smol-toml already rejects such TOML integers.
// - JSON numbers that overflow to ±Infinity (1e400).
// - Infinity and NaN going to JSON, which has no form for them (JSON.stringify writes null).
// - null going to TOML, which has no null (smol-toml drops object keys and throws on arrays).
// - YAML timestamps going to TOML: a date becomes a TOML local date; a date-time becomes an
//   offset date-time with its offset (none means UTC, as the YAML timestamp type defines).
//   smol-toml keeps milliseconds, so more digits are a loss; impossible dates such as
//   2026-02-31 (js-yaml rolls them over to March) are rejected.
// Paths are JSON Pointers (RFC 6901). Nothing here touches the DOM, storage or network.

export class LossyValue {
  constructor(kind, raw) { this.kind = kind; this.raw = raw; }
}
export class YamlTimestamp {
  constructor(raw) { this.raw = raw; }
}

const SAFE_INT_LITERAL = /^-?(0|[1-9][0-9]*)$/;

/* JSON.parse that marks integers JavaScript cannot hold exactly and numbers that overflow. */
export function parseJsonExact(text) {
  return JSON.parse(text, function (_key, value, context) {
    if (typeof value !== 'number') return value;
    var src = context && typeof context.source === 'string' ? context.source : null;
    var integral = src !== null ? SAFE_INT_LITERAL.test(src) : Number.isInteger(value) || !Number.isFinite(value);
    if (integral && !Number.isSafeInteger(value)) return new LossyValue('unsafeInteger', src !== null ? src : String(value));
    if (!Number.isFinite(value)) return new LossyValue('numberRange', src !== null ? src : String(value));
    return value;
  });
}

/* The js-yaml schema the converters load with: the default schema, with the int type marking
   integers outside the safe range and, for TOML output, timestamps kept as their text. */
export function yamlLoadSchema(jsyaml, opts) {
  var intType = jsyaml.types.int;
  var types = [new jsyaml.Type('tag:yaml.org,2002:int', {
    kind: 'scalar',
    resolve: intType.resolve,
    construct: function (data) {
      var v = intType.construct(data);
      return Number.isSafeInteger(v) ? v : new LossyValue('unsafeInteger', String(data));
    },
  })];
  if (opts && opts.timestamps) {
    var ts = jsyaml.types.timestamp;
    types.push(new jsyaml.Type('tag:yaml.org,2002:timestamp', {
      kind: 'scalar',
      resolve: ts.resolve,
      construct: function (data) { return new YamlTimestamp(String(data)); },
    }));
  }
  return jsyaml.DEFAULT_SCHEMA.extend({ implicit: types });
}

const YAML_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
// Same groups as js-yaml's YAML_TIMESTAMP_REGEXP.
const YAML_TIMESTAMP = /^([0-9]{4})-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \t]+)([0-9][0-9]?):([0-9]{2}):([0-9]{2})(?:\.([0-9]*))?(?:[ \t]*(Z|([-+])([0-9][0-9]?)(?::([0-9]{2}))?))?$/;
const pad2 = (s) => (s.length < 2 ? '0' + s : s);

function validDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  var dt = new Date(Date.UTC(2000, m - 1, d));
  dt.setUTCFullYear(y);
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/* YAML timestamp text → { text } for TomlDate, or { loss } */
export function yamlTimestampToToml(raw) {
  var m = YAML_DATE.exec(raw);
  if (m) return validDate(+m[1], +m[2], +m[3]) ? { text: raw } : { loss: 'timestampInvalid' };
  m = YAML_TIMESTAMP.exec(raw);
  if (!m) return { loss: 'timestampInvalid' };
  var y = m[1], mo = pad2(m[2]), d = pad2(m[3]), h = pad2(m[4]), mi = m[5], s = m[6];
  if (!validDate(+y, +mo, +d) || +h > 23 || +mi > 59 || +s > 59) return { loss: 'timestampInvalid' };
  var frac = m[7] || '';
  if (/[1-9]/.test(frac.slice(3))) return { loss: 'timestampPrecision' };
  frac = frac.slice(0, 3);
  var tz = 'Z';
  if (m[9]) {
    var oh = +m[10], om = m[11] ? +m[11] : 0;
    if (oh > 23 || om > 59) return { loss: 'timestampInvalid' };
    tz = m[9] + pad2(String(oh)) + ':' + pad2(String(om));
  }
  return { text: y + '-' + mo + '-' + d + 'T' + h + ':' + mi + ':' + s + (frac ? '.' + frac : '') + tz };
}

export function pointer(segs) {
  return segs.map(function (s) { return '/' + String(s).replace(/~/g, '~0').replace(/\//g, '~1'); }).join('');
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  var p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/* Walks a parsed value for the target format ('json' | 'toml' | 'yaml'). Returns the losses
   (at most `limit` listed, `count` all) and replaces YAML timestamps with TomlDate in place. */
export function findLosses(root, target, lib, limit) {
  var max = limit || 20;
  var losses = [];
  var count = 0;
  function add(segs, kind, raw) { count++; if (losses.length < max) losses.push({ path: pointer(segs), kind: kind, raw: raw }); }
  function visit(v, segs, set) {
    if (v instanceof LossyValue) { add(segs, v.kind, v.raw); return; }
    if (v instanceof YamlTimestamp) {
      var r = yamlTimestampToToml(v.raw);
      if (r.loss) add(segs, r.loss, v.raw);
      else set(new lib.TomlDate(r.text));
      return;
    }
    if (typeof v === 'number' && !Number.isFinite(v) && target === 'json') {
      add(segs, 'nonFinite', Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf');
      return;
    }
    if ((v === null || v === undefined) && target === 'toml') { add(segs, 'null', 'null'); return; }
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) visit(v[i], segs.concat(i), (function (j) { return function (x) { v[j] = x; }; })(i));
    } else if (isPlainObject(v)) {
      Object.keys(v).forEach(function (k) { visit(v[k], segs.concat(k), function (x) { v[k] = x; }); });
    }
  }
  visit(root, [], function () {});
  return { losses: losses, count: count };
}

const TEXT = {
  en: {
    title: 'Not converted: {target} cannot hold these values without changing them',
    unsafeInteger: 'integer {raw} is outside ±(2^53 − 1), so JavaScript would round it',
    numberRange: '{raw} is outside the range of a double-precision number',
    nonFinite: '{raw} has no JSON form (JSON.stringify would write null)',
    null: 'null — TOML has no null',
    timestampPrecision: '{raw} has more than millisecond precision',
    timestampInvalid: '{raw} is not a valid date or time',
    more: 'and {n} more',
    root: '(root)',
  },
  zh: {
    title: '未转换：{target} 无法原样保存下列值',
    unsafeInteger: '整数 {raw} 超出 ±(2^53 − 1)，JavaScript 会把它四舍五入',
    numberRange: '{raw} 超出双精度浮点数的范围',
    nonFinite: '{raw} 在 JSON 中没有写法（JSON.stringify 会写成 null）',
    null: 'null，TOML 没有 null',
    timestampPrecision: '{raw} 的精度超过毫秒',
    timestampInvalid: '{raw} 不是有效的日期或时间',
    more: '另有 {n} 处',
    root: '（根）',
  },
  ja: {
    title: '変換していません：{target} では次の値を変えずに表せません',
    unsafeInteger: '整数 {raw} は ±(2^53 − 1) を超えるため、JavaScript では丸められます',
    numberRange: '{raw} は倍精度浮動小数点数の範囲を超えています',
    nonFinite: '{raw} は JSON で表せません（JSON.stringify は null と書きます）',
    null: 'null — TOML には null がありません',
    timestampPrecision: '{raw} はミリ秒より細かい精度を持っています',
    timestampInvalid: '{raw} は有効な日付・時刻ではありません',
    more: 'ほか {n} 件',
    root: '（ルート）',
  },
  ko: {
    title: '변환하지 않았습니다: {target}에서는 다음 값을 바꾸지 않고 나타낼 수 없습니다',
    unsafeInteger: '정수 {raw} — ±(2^53 − 1) 범위를 벗어나 JavaScript에서 반올림됩니다',
    numberRange: '{raw} — 배정밀도 부동소수점 수의 범위를 벗어납니다',
    nonFinite: '{raw} — JSON으로 나타낼 수 없습니다(JSON.stringify는 null로 씁니다)',
    null: 'null — TOML에는 null이 없습니다',
    timestampPrecision: '{raw} — 밀리초보다 정밀합니다',
    timestampInvalid: '{raw} — 올바른 날짜나 시각이 아닙니다',
    more: '외 {n}건',
    root: '(루트)',
  },
};
export const FIDELITY_TEXT = TEXT;

/* One status line: title, then "path: reason" items separated by semicolons. */
export function formatLosses(result, target, lang) {
  var t = TEXT[lang] || TEXT.en;
  var wide = lang === 'zh' || lang === 'ja';
  var sep = wide ? '；' : '; ';
  var colon = wide ? '：' : ': ';
  var items = result.losses.map(function (l) {
    return (l.path || t.root) + colon + t[l.kind].replace('{raw}', l.raw);
  });
  if (result.count > result.losses.length) items.push(t.more.replace('{n}', String(result.count - result.losses.length)));
  return t.title.replace('{target}', target) + colon + items.join(sep);
}
