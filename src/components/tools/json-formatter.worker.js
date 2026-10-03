import { createFormatterRunner } from './json-formatter-run.js';
const run = createFormatterRunner();
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, type: 'result', result: run(data) });
  } catch (error) {
    self.postMessage({ id: data.id, type: 'error', message: (error && error.message) || String(error) });
  }
};
