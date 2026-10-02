import { createTokenRunner } from './ai-token-counter-run.js';
const run = createTokenRunner();
self.onmessage = async ({ data }) => {
  try {
    const result = await run(data, progress => self.postMessage({ id: data.id, type: 'progress', ...progress }));
    self.postMessage({ id: data.id, type: 'result', result, sentAt: performance.timeOrigin + performance.now() });
  } catch (error) {
    self.postMessage({ id: data.id, type: 'error', message: error.message || String(error) });
  }
};
