// Builds /llms.txt, /{zh,ja,ko}/llms.txt and /llms-full.txt (https://llmstxt.org/).
//
// The endpoints in src/pages/ collect the data (tools.ts, network.ts, persistence.ts,
// the i18n JSON and the tools content collection) and pass it here, so every tool
// entry comes from the same sources as the tool pages. Only the site notes below are
// written by hand.
//
// Plain JS with no Node or Astro imports: the endpoints and
// scripts/test-llms-txt.mjs import it directly.

export const SITE = 'https://zerotool.dev';
export const LLMS_LANGS = ['en', 'zh', 'ja', 'ko'];
// Same order as the category filter chips (src/components/CategoryFilter.astro).
export const CATEGORY_ORDER = ['data', 'color', 'encoding', 'text', 'security', 'dev', 'api', 'image'];
export const REPO_URL = 'https://github.com/kassol/zerotool-dev';

// llms-full.txt "How to use" limits.
export const MAX_STEPS = 8;
export const MAX_STEP_CHARS = 280;
export const MAX_HOWTO_CHARS = 1200;

const LANG_NAMES = { en: 'English', zh: '中文', ja: '日本語', ko: '한국어' };

export function langPrefix(lang) {
  return lang === 'en' ? '' : `/${lang}`;
}

export function toolUrl(slug, lang = 'en') {
  return `${SITE}${langPrefix(lang)}/tools/${slug}/`;
}

export function llmsUrl(lang = 'en') {
  return `${SITE}${langPrefix(lang)}/llms.txt`;
}

// Hand-written site notes, one set per language. Wording of the privacy notes follows
// the About pages (src/pages/{,zh/,ja/,ko/}about.astro).
const COPY = {
  en: {
    intro: (n) => `ZeroTool (${SITE}) has ${n} free developer tools. Each tool is one web page; there is no account and no API.`,
    urls: `Tool pages are at ${SITE}/tools/{slug}/ in English and at /zh/tools/{slug}/, /ja/tools/{slug}/ and /ko/tools/{slug}/ in Chinese, Japanese and Korean. The same tools are listed with their names in those languages in the files under "Other languages".`,
    local: 'The tools process the text, files and keys you give them with JavaScript in your browser tab and do not upload them.',
    network: 'These tools send requests because of what they do:',
    optional: 'This tool uses the network only after you turn on an option:',
    analytics: 'Most pages load Google Analytics 4 (page views, and tool-use events that record the tool name and action, not your input) and Google AdSense. Pages for tools that handle credentials, keys, tokens, or private files and text load neither:',
    source: `Source code: ${REPO_URL}`,
    networkLabel: 'Network',
    otherLanguages: 'Other languages',
    otherNote: {
      en: 'English tool names and descriptions; links to /tools/',
      zh: 'Chinese tool names and descriptions; links to /zh/tools/',
      ja: 'Japanese tool names and descriptions; links to /ja/tools/',
      ko: 'Korean tool names and descriptions; links to /ko/tools/',
    },
    optionalHeading: 'Optional',
    optionalLinks: [
      ['Full tool reference', '/llms-full.txt', 'Every tool with its page summary, the "How to Use" steps from its page, and whether it uses the network (English)'],
      ['All tools', '/tools/', 'Tool directory with search and category filters'],
      ['Blog', '/blog/', 'Guides to the tools and the formats they handle'],
      ['About', '/about/', 'What stays on your device, analytics and ads, open source'],
      ['Privacy Policy', '/privacy/', null],
    ],
    listSep: ', ',
    sp: ' ',
    colon: ': ',
    end: '.',
  },
  zh: {
    intro: (n) => `ZeroTool（${SITE}）提供 ${n} 个免费开发者工具。每个工具是一个网页，无需账号，没有 API。`,
    urls: `中文工具页地址为 ${SITE}/zh/tools/{slug}/，英文版去掉 /zh（/tools/{slug}/），日文、韩文版分别在 /ja/、/ko/ 下。`,
    local: '工具用浏览器标签页里的 JavaScript 处理你交给它的文本、文件和密钥，不上传。',
    network: '以下工具因功能需要会联网：',
    optional: '以下工具只在你打开某个选项后才联网：',
    analytics: '大多数页面会加载 Google Analytics 4（统计页面浏览和工具使用，工具使用事件只记录工具名和操作，不记录输入）与 Google AdSense。处理凭据、密钥、令牌或私密文件与文本的工具页，两者都不加载：',
    source: `源代码：${REPO_URL}`,
    networkLabel: '联网',
    otherLanguages: '其他语言',
    otherNote: {
      en: '英文工具名与说明，链接到 /tools/',
      zh: '中文工具名与说明，链接到 /zh/tools/',
      ja: '日文工具名与说明，链接到 /ja/tools/',
      ko: '韩文工具名与说明，链接到 /ko/tools/',
    },
    optionalHeading: 'Optional',
    optionalLinks: [
      ['全部工具', '/zh/tools/', '工具目录，可搜索、按分类筛选'],
      ['博客', '/zh/blog/', '工具与相关格式的指南'],
      ['关于', '/zh/about/', '哪些数据留在设备上、统计与广告、开源'],
      ['隐私政策', '/zh/privacy/', null],
      ['完整工具说明（英文）', '/llms-full.txt', '每个工具的页面摘要、使用步骤与是否联网'],
    ],
    listSep: '、',
    sp: '',
    colon: '：',
    end: '。',
  },
  ja: {
    intro: (n) => `ZeroTool（${SITE}）は ${n} 個の無料開発者ツールを提供しています。各ツールは 1 つの Web ページで、アカウントも API もありません。`,
    urls: `日本語のツールページは ${SITE}/ja/tools/{slug}/ にあります。英語版は /ja を除いた /tools/{slug}/、中国語版と韓国語版は /zh/、/ko/ の下にあります。`,
    local: 'ツールは入力されたテキスト、ファイル、鍵をブラウザーのタブ内の JavaScript で処理し、アップロードしません。',
    network: '次のツールは機能上ネットワークを使います：',
    optional: '次のツールはオプションをオンにしたときだけネットワークを使います：',
    analytics: 'ほとんどのページは Google Analytics 4（ページビューとツールの利用を計測。ツール利用イベントにはツール名と操作だけを記録し、入力内容は記録しません）と Google AdSense を読み込みます。認証情報、鍵、トークン、非公開のファイルやテキストを扱うツールのページはどちらも読み込みません：',
    source: `ソースコード：${REPO_URL}`,
    networkLabel: '通信',
    otherLanguages: '他の言語',
    otherNote: {
      en: '英語のツール名と説明、/tools/ へのリンク',
      zh: '中国語のツール名と説明、/zh/tools/ へのリンク',
      ja: '日本語のツール名と説明、/ja/tools/ へのリンク',
      ko: '韓国語のツール名と説明、/ko/tools/ へのリンク',
    },
    optionalHeading: 'Optional',
    optionalLinks: [
      ['すべてのツール', '/ja/tools/', '検索とカテゴリーで絞り込めるツール一覧'],
      ['ブログ', '/ja/blog/', 'ツールと関連する形式のガイド'],
      ['ZeroTool について', '/ja/about/', 'デバイスに留まるデータ、アクセス解析と広告、オープンソース'],
      ['プライバシーポリシー', '/ja/privacy/', null],
      ['ツールの詳しい説明（英語）', '/llms-full.txt', '各ツールのページ概要、使い方の手順、ネットワークを使うかどうか'],
    ],
    listSep: '、',
    sp: '',
    colon: '：',
    end: '。',
  },
  ko: {
    intro: (n) => `ZeroTool(${SITE})은 무료 개발자 도구 ${n}개를 제공합니다. 도구마다 웹 페이지 하나이며, 계정과 API는 없습니다.`,
    urls: `한국어 도구 페이지는 ${SITE}/ko/tools/{slug}/ 에 있습니다. 영어판은 /ko를 뺀 /tools/{slug}/, 중국어판과 일본어판은 /zh/, /ja/ 아래에 있습니다.`,
    local: '도구는 입력한 텍스트, 파일, 키를 브라우저 탭의 JavaScript로 처리하며 업로드하지 않습니다.',
    network: '다음 도구는 기능상 네트워크를 사용합니다:',
    optional: '다음 도구는 옵션을 켰을 때만 네트워크를 사용합니다:',
    analytics: '대부분의 페이지는 Google Analytics 4(페이지 조회수와 도구 사용을 집계하며, 도구 사용 이벤트에는 도구 이름과 동작만 기록하고 입력 내용은 기록하지 않음)와 Google AdSense를 불러옵니다. 자격 증명, 키, 토큰, 비공개 파일과 텍스트를 다루는 도구 페이지는 둘 다 불러오지 않습니다:',
    source: `소스 코드: ${REPO_URL}`,
    networkLabel: '네트워크',
    otherLanguages: '다른 언어',
    otherNote: {
      en: '영어 도구 이름과 설명, /tools/ 링크',
      zh: '중국어 도구 이름과 설명, /zh/tools/ 링크',
      ja: '일본어 도구 이름과 설명, /ja/tools/ 링크',
      ko: '한국어 도구 이름과 설명, /ko/tools/ 링크',
    },
    optionalHeading: 'Optional',
    optionalLinks: [
      ['전체 도구', '/ko/tools/', '검색과 카테고리 필터가 있는 도구 목록'],
      ['블로그', '/ko/blog/', '도구와 관련 형식 가이드'],
      ['ZeroTool 소개', '/ko/about/', '기기에 남는 데이터, 분석과 광고, 오픈 소스'],
      ['개인정보처리방침', '/ko/privacy/', null],
      ['도구 상세 설명(영어)', '/llms-full.txt', '각 도구의 페이지 요약, 사용 단계, 네트워크 사용 여부'],
    ],
    listSep: ', ',
    sp: ' ',
    colon: ': ',
    end: '.',
  },
};

/**
 * @typedef {{ slug: string, category: string, translations: Record<string, { name: string, description: string }> }} Tool
 * @typedef {{
 *   tools: Tool[],
 *   networkSlugs: readonly string[],
 *   optionalNetworkSlugs: readonly string[],
 *   sensitiveSlugs: readonly string[],
 *   messages: Record<string, Record<string, string>>,
 * }} SiteData
 */

function msg(data, lang, key) {
  const value = data.messages[lang]?.[key] ?? data.messages.en?.[key];
  if (value === undefined) throw new Error(`llms: missing i18n key ${key}`);
  return value;
}

/** Network note for a tool, or null when the tool makes no requests. */
export function networkNote(data, slug, lang) {
  if (data.networkSlugs.includes(slug)) return msg(data, lang, `network.${slug}`);
  if (data.optionalNetworkSlugs.includes(slug)) return msg(data, lang, `networkOptional.${slug}`);
  return null;
}

function withEnd(text, end) {
  return /[.。!?！？]$/.test(text) ? text : text + end;
}

function sortedTools(tools) {
  return [...tools].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

function toolsByCategory(tools) {
  const unknown = tools.filter((t) => !CATEGORY_ORDER.includes(t.category));
  if (unknown.length) throw new Error(`llms: unknown category for ${unknown.map((t) => t.slug).join(', ')}`);
  return CATEGORY_ORDER
    .map((category) => [category, sortedTools(tools.filter((t) => t.category === category))])
    .filter(([, list]) => list.length > 0);
}

function nameOf(tool, lang) {
  return tool.translations[lang]?.name ?? tool.translations.en.name;
}

function descriptionOf(tool, lang) {
  return tool.translations[lang]?.description ?? tool.translations.en.description;
}

// The notes block between the summary and the first H2. Lists only; the spec allows
// any markdown except headings here.
function siteNotes(data, lang) {
  const c = COPY[lang];
  const bySlug = new Map(data.tools.map((t) => [t.slug, t]));
  const link = (slug) => `[${nameOf(bySlug.get(slug), lang)}](${toolUrl(slug, lang)})`;
  const lines = [
    c.intro(data.tools.length),
    '',
    `- ${c.urls}`,
    `- ${c.local}`,
  ];
  const network = data.networkSlugs.filter((s) => bySlug.has(s));
  if (network.length) {
    lines.push(`- ${c.network}`);
    for (const slug of network) lines.push(`  - ${link(slug)}: ${withEnd(networkNote(data, slug, lang), c.end)}`);
  }
  const optional = data.optionalNetworkSlugs.filter((s) => bySlug.has(s));
  if (optional.length) {
    lines.push(`- ${c.optional}`);
    for (const slug of optional) lines.push(`  - ${link(slug)}: ${withEnd(networkNote(data, slug, lang), c.end)}`);
  }
  const sensitive = sortedTools(data.tools.filter((t) => data.sensitiveSlugs.includes(t.slug)));
  lines.push(`- ${c.analytics}${c.sp}${sensitive.map((t) => link(t.slug)).join(c.listSep)}${c.end}`);
  lines.push(`- ${c.source}`);
  return lines;
}

/** One `/llms.txt` (en) or `/{lang}/llms.txt` file. */
export function buildLlmsTxt(data, lang = 'en') {
  const c = COPY[lang];
  if (!c) throw new Error(`llms: unsupported language ${lang}`);
  const out = [
    '# ZeroTool',
    '',
    `> ${msg(data, lang, 'footer.tagline')}`,
    '',
    ...siteNotes(data, lang),
  ];

  for (const [category, tools] of toolsByCategory(data.tools)) {
    out.push('', `## ${msg(data, lang, `category.${category}`)}`, '');
    for (const tool of tools) {
      let line = `- [${nameOf(tool, lang)}](${toolUrl(tool.slug, lang)}): ${withEnd(descriptionOf(tool, lang), c.end)}`;
      const note = networkNote(data, tool.slug, lang);
      if (note) line += `${c.sp}${c.networkLabel}${c.colon}${withEnd(note, c.end)}`;
      out.push(line);
    }
  }

  out.push('', `## ${c.otherLanguages}`, '');
  for (const other of LLMS_LANGS.filter((l) => l !== lang)) {
    out.push(`- [${LANG_NAMES[other]}](${llmsUrl(other)}): ${c.otherNote[other]}`);
  }

  out.push('', `## ${c.optionalHeading}`, '');
  for (const [title, path, note] of c.optionalLinks) {
    out.push(`- [${title}](${SITE}${path})${note ? `: ${note}` : ''}`);
  }
  return out.join('\n') + '\n';
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rarr: '→', larr: '←', times: '×', mdash: '—', ndash: '–', hellip: '…' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** MDX / HTML / Markdown fragment → one line of plain text. Inline code keeps its backticks. */
export function plainText(fragment) {
  // Literal pieces are set aside so the tag, link and emphasis rules below leave them alone.
  const kept = [];
  const keep = (s) => `\u0000${kept.push(s) - 1}\u0000`;
  let text = fragment
    // MDX string expressions such as {'[x](url)'} → their literal text.
    .replace(/\{\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\}/g, (_, _q, s) => keep(s.replace(/\\(.)/g, '$1')))
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, s) => '`' + s + '`')
    .replace(/`([^`]+)`/g, (_, s) => keep('`' + decodeEntities(s.replace(/<[^>]+>/g, '')) + '`'))
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])\*(?!\s)([^*]+?)\*(?=[\s).,;:!?]|$)/g, '$1$2');
  // A kept piece can hold an earlier one (<code>{"'x'"}</code>), so put them back recursively.
  const restore = (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i) => restore(kept[Number(i)]));
  text = restore(decodeEntities(text))
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '') + '…';
}

/** Steps for llms-full.txt, read only from the tool page's frontmatter. */
export function toolSteps(page) {
  return Array.isArray(page?.steps) ? limitSteps(page.steps) : [];
}

function limitSteps(items) {
  const steps = [];
  let total = 0;
  for (const raw of items) {
    const step = truncate(plainText(raw), MAX_STEP_CHARS);
    if (!step) continue;
    if (steps.length >= MAX_STEPS || total + step.length > MAX_HOWTO_CHARS) break;
    steps.push(step);
    total += step.length;
  }
  return steps;
}

/**
 * `/llms-full.txt`: one H2 per tool, English, in category order. `pages` maps a slug to
 * the English tool page content entry `{ seoDescription, steps }`; the "How to use"
 * steps come from toolSteps().
 */
export function buildLlmsFullTxt(data, pages) {
  const c = COPY.en;
  const out = [
    '# ZeroTool: full tool reference',
    '',
    `> ${msg(data, 'en', 'footer.tagline')}`,
    '',
    ...siteNotes(data, 'en'),
    '- Each entry below gives the tool page URL and its Chinese, Japanese and Korean versions, the category, the tool description from the site catalog, the page summary (the page\'s meta description, when it differs), whether the tool uses the network, and up to 8 "How to Use" steps copied from the tool page.',
  ];

  for (const [category, tools] of toolsByCategory(data.tools)) {
    for (const tool of tools) {
      const page = pages[tool.slug];
      if (!page) throw new Error(`llms: no English content entry for ${tool.slug}`);
      const description = withEnd(descriptionOf(tool, 'en'), '.');
      const summary = page.seoDescription ? withEnd(page.seoDescription.trim(), '.') : '';
      const note = networkNote(data, tool.slug, 'en');
      out.push('', `## ${nameOf(tool, 'en')}`, '');
      out.push(`- URL: ${toolUrl(tool.slug)}`);
      out.push(`- Other languages: ${LLMS_LANGS.filter((l) => l !== 'en').map((l) => `${nameOf(tool, l)} ${toolUrl(tool.slug, l)}`).join('; ')}`);
      out.push(`- Category: ${msg(data, 'en', `category.${category}`)}`);
      out.push(`- Description: ${description}`);
      if (summary && summary !== description) out.push(`- Page summary: ${summary}`);
      out.push(`- ${c.networkLabel}: ${note ? withEnd(note, '.') : 'None. The tool makes no requests with your input.'}`);
      if (data.sensitiveSlugs.includes(tool.slug)) {
        out.push('- Storage and tracking: saves nothing in the browser; the page loads neither Google Analytics nor AdSense.');
      }
      const steps = toolSteps(page);
      if (steps.length) {
        out.push('', 'How to use:', '');
        steps.forEach((step, i) => out.push(`${i + 1}. ${step}`));
      }
    }
  }
  return out.join('\n') + '\n';
}
