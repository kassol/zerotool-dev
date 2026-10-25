// Build-time links only: the language is the sole input. No page URL, tool data
// or browser state is accepted. External services control their query handling.
import { SITE, LLMS_LANGS, langPrefix, llmsUrl } from './llms.mjs';

const QUESTIONS = {
  en: 'Explain which ZeroTool developer tools help with common tasks and what their limits are, including network use and saved data. Start with these sources, cite relevant tool pages, and distinguish verified facts from unknowns. Answer in English.',
  zh: '请介绍 ZeroTool 中适合常见开发任务的工具及其限制，包括联网与保存数据的行为。从以下资料开始，引用相关工具页，并区分已核实的事实与未知信息。请用中文回答。',
  ja: 'ZeroTool で日常の開発作業に役立つツールとその制限を、通信やデータ保存の動作も含めて説明してください。以下の資料を起点に、関連するツールページを引用し、確認済みの事実と不明な点を区別してください。日本語で回答してください。',
  ko: '일상적인 개발 작업에 도움이 되는 ZeroTool 도구와 제한 사항을 네트워크 사용 및 데이터 저장 동작을 포함해 설명해 주세요. 다음 자료에서 시작해 관련 도구 페이지를 인용하고, 확인된 사실과 알 수 없는 정보를 구분해 주세요. 한국어로 답해 주세요.',
};

// OpenAI / Google paths: Tabler Icons (MIT). Grok: Lobe Icons (MIT).
// Claude / Perplexity: Simple Icons (CC0-1.0). Retrieved 2026-10-25.
// https://github.com/tabler/tabler-icons/tree/main/icons/outline
// https://github.com/lobehub/lobe-icons/tree/master/packages/static-svg/icons
// https://github.com/simple-icons/simple-icons/tree/develop/icons
const PROVIDERS = [
  {
    id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', stroke: true,
    icon: '<path d="M11.217 19.384a3.501 3.501 0 0 0 6.783 -1.217v-5.167l-6 -3.35"/><path d="M5.214 15.014a3.501 3.501 0 0 0 4.446 5.266l4.34 -2.534v-6.946"/><path d="M6 7.63c-1.391 -.236 -2.787 .395 -3.534 1.689a3.474 3.474 0 0 0 1.271 4.745l4.263 2.514l6 -3.348"/><path d="M12.783 4.616a3.501 3.501 0 0 0 -6.783 1.217v5.067l6 3.45"/><path d="M18.786 8.986a3.501 3.501 0 0 0 -4.446 -5.266l-4.34 2.534v6.946"/><path d="M18 16.302c1.391 .236 2.787 -.395 3.534 -1.689a3.474 3.474 0 0 0 -1.271 -4.745l-4.308 -2.514l-5.955 3.42"/>',
  },
  {
    id: 'claude', name: 'Claude', url: 'https://claude.ai/new',
    icon: '<path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>',
  },
  {
    id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/search',
    icon: '<path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"/>',
  },
  {
    id: 'google-ai', name: 'Google AI Mode', url: 'https://www.google.com/search', stroke: true,
    icon: '<path d="M20.945 11a9 9 0 1 1 -3.284 -5.997l-2.655 2.392a5.5 5.5 0 1 0 2.119 6.605h-4.125v-3h7.945"/>',
  },
  {
    id: 'grok', name: 'Grok', url: 'https://grok.com/',
    icon: '<path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"/>',
  },
];

export function aiQuestion(lang = 'en') {
  if (!LLMS_LANGS.includes(lang)) throw new Error(`agents: unsupported language ${lang}`);
  return `${QUESTIONS[lang]}\n${llmsUrl(lang)}\n${SITE}${langPrefix(lang)}/index.md`;
}

export function aiLinks(lang = 'en') {
  const question = aiQuestion(lang);
  return PROVIDERS.map(({ url: destination, ...provider }) => {
    const url = new URL(destination);
    if (provider.id === 'google-ai') url.searchParams.set('udm', '50');
    url.searchParams.set('q', question);
    return { ...provider, href: url.href };
  });
}

/*
MIT License — Tabler Icons and Lobe Icons

Copyright (c) 2020-2026 Paweł Kuna
Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
