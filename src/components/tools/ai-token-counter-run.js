import { createTiktokenEncoding, createHfBpeEncoding, encodeSteps, textStats, tokenLabel } from './ai-token-counter-engine.js';

// Both the shipped worker and the tests call this runner. Only bounded token previews leave it.
// importRanks(key) returns the o200k / cl100k rank data or the DeepSeek tokenizer module.
export function createTokenRunner(importRanks) {
  const loaded = new Map();
  async function load(key) {
    if (!loaded.has(key)) {
      const promise = importRanks(key).then(data => key === 'deepseek'
        ? createHfBpeEncoding('DeepSeek V4', data)
        : createTiktokenEncoding(key === 'o200k' ? 'o200k_base' : 'cl100k_base', data));
      loaded.set(key, promise);
      promise.catch(() => { if (loaded.get(key) === promise) loaded.delete(key); });
    }
    return loaded.get(key);
  }
  return async function run(message, progress = () => {}) {
    if (message.type === 'prefetch') { await load('o200k'); return {}; }
    const start = performance.now();
    const stats = textStats(message.text);
    const results = {};
    const failed = {};
    for (const key of message.keys) {
      try {
        progress({ key, loading: true });
        const encoding = await load(key);
        const step = encodeSteps(encoding, message.text, () => performance.now());
        let r;
        do {
          r = step(30);
          if (!r.done) {
            progress({ key, pct: Math.floor(r.progress * 100) });
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        } while (!r.done);
        results[key] = { count: r.ids.length, tokens: r.ids.slice(0, 2000).map(id => ({ id, ...tokenLabel(encoding.tokenBytes(id)) })) };
      } catch (error) { failed[key] = error.message || String(error); }
    }
    return { stats, results, failed, ms: performance.now() - start };
  };
}

export function createTokenClient(makeWorker) {
  let worker = null;
  let sequence = 0;
  let running = false;
  const pending = new Map();
  function reset(error) {
    const old = worker;
    worker = null;
    running = false;
    if (old) old.terminate();
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  function request(type, payload = {}, progress) {
    if (!worker) {
      const instance = makeWorker();
      worker = instance;
      instance.onmessage = ({ data }) => {
        if (worker !== instance) return;
        const item = pending.get(data.id);
        if (!item) return;
        if (data.type === 'progress') { item.progress?.(data); return; }
        pending.delete(data.id);
        if (item.type === 'count') running = false;
        if (data.type === 'error') item.reject(new Error(data.message));
        else item.resolve(data.result);
      };
      instance.onerror = instance.onmessageerror = () => {
        if (worker === instance) reset(new Error('Worker failed'));
      };
    }
    const id = ++sequence;
    if (type === 'count') running = true;
    return new Promise((resolve, reject) => {
      pending.set(id, { type, resolve, reject, progress });
      try { worker.postMessage({ id, type, ...payload }); }
      catch (error) { reset(error); }
    });
  }
  return {
    prefetch: () => request('prefetch'),
    count: (text, keys, progress) => request('count', { text, keys }, progress),
    cancel() { if (running) { const error = new Error('Cancelled'); error.name = 'AbortError'; reset(error); } },
    dispose() { const error = new Error('Cancelled'); error.name = 'AbortError'; reset(error); },
  };
}
