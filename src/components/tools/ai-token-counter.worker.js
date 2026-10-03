import { createTokenRunner } from './ai-token-counter-run.js';
import o200kUrl from 'js-tiktoken/ranks/o200k_base?url';
import cl100kUrl from 'js-tiktoken/ranks/cl100k_base?url';
import deepseekUrl from '../../data/deepseek-v4-tokenizer.mjs?url';

// Vite builds workers as one IIFE file and cannot split chunks out of them, so the vocabulary
// modules are emitted as separate files (?url) and imported by URL when a count needs them.
const RANK_URLS = { o200k: o200kUrl, cl100k: cl100kUrl, deepseek: deepseekUrl };
const run = createTokenRunner(async (key) => {
  const mod = await import(/* @vite-ignore */ RANK_URLS[key]);
  return key === 'deepseek' ? mod : mod.default;
});
self.onmessage = async ({ data }) => {
  try {
    const result = await run(data, progress => self.postMessage({ id: data.id, type: 'progress', ...progress }));
    self.postMessage({ id: data.id, type: 'result', result, sentAt: performance.timeOrigin + performance.now() });
  } catch (error) {
    self.postMessage({ id: data.id, type: 'error', message: error.message || String(error) });
  }
};
