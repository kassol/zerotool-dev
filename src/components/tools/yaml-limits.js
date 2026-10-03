// js-yaml 4.3 work limits — the default load() options every YAML tool on this site uses, and the
// text that replaces the library's English reason when one of them stops a document.
//
// js-yaml 4.3.2 loader.js: `maxDepth` (default 100, nesting of collections; aliases are not
// counted) throws "nesting exceeded maxDepth (N)"; `maxTotalMergeKeys` (default 10000; each
// merged mapping costs 1 and each of its keys 1, across one load() / loadAll() call) throws
// "merge keys exceeded maxTotalMergeKeys (N)"; a merge key (<<) that lists more than 100
// mappings throws "abnormal merge sequence size". The tools keep these defaults.
// Shared by YamlJsonTool, YamlTomlTool, YamlValidatorTool, JsonSchemaValidatorTool and
// OpenapiToTypescriptTool; OpenAPI Validator keeps the same texts in its own yamlReasons table.

export const YAML_LIMITS = { maxDepth: 100, maxTotalMergeKeys: 10000, maxMergeSources: 100 };

const TEXT = {
  en: {
    depth: 'collections are nested more than {n} levels deep (the js-yaml default limit)',
    mergeKeys: 'merge keys (<<) handle more than {n} mappings and keys in total (the js-yaml default limit)',
    mergeSources: 'one merge key (<<) lists more than {n} mappings (the js-yaml limit)',
  },
  zh: {
    depth: '集合嵌套超过 {n} 层（js-yaml 默认上限）',
    mergeKeys: '合并键（<<）累计处理的映射和键超过 {n} 个（js-yaml 默认上限）',
    mergeSources: '一个合并键（<<）列出的映射超过 {n} 个（js-yaml 上限）',
  },
  ja: {
    depth: 'コレクションのネストが {n} 階層を超えています（js-yaml の既定の上限）',
    mergeKeys: 'マージキー（<<）で処理するマッピングとキーが合計 {n} 個を超えています（js-yaml の既定の上限）',
    mergeSources: '1 つのマージキー（<<）に {n} 個を超えるマッピングが並んでいます（js-yaml の上限）',
  },
  ko: {
    depth: '컬렉션 중첩이 {n}단계를 넘습니다(js-yaml 기본 한도)',
    mergeKeys: '병합 키(<<)가 처리하는 매핑과 키가 모두 {n}개를 넘습니다(js-yaml 기본 한도)',
    mergeSources: '병합 키(<<) 하나에 매핑이 {n}개를 넘게 나열되어 있습니다(js-yaml 한도)',
  },
};

/* The localized text for a js-yaml reason that comes from a work limit, or null. */
export function yamlLimitText(reason, lang) {
  var t = TEXT[lang] || TEXT.en;
  var m;
  if ((m = /^nesting exceeded maxDepth \((\d+)\)$/.exec(reason || ''))) return t.depth.replace('{n}', m[1]);
  if ((m = /^merge keys exceeded maxTotalMergeKeys \((\d+)\)$/.exec(reason || ''))) return t.mergeKeys.replace('{n}', m[1]);
  if (reason === 'abnormal merge sequence size') return t.mergeSources.replace('{n}', String(YAML_LIMITS.maxMergeSources));
  return null;
}

/* A YAMLException as one line for a status message: the localized limit text with (line:column),
   or the library message unchanged. */
export function yamlErrorText(e, lang) {
  var local = e && yamlLimitText(e.reason, lang);
  if (!local) return (e && e.message) || String(e);
  return e.mark ? local + ' (' + (e.mark.line + 1) + ':' + (e.mark.column + 1) + ')' : local;
}
