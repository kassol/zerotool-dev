// SVG Optimizer worker — runs SVGO off the main thread so large files do not freeze the
// page. Message in: { id, text, config }. Message out: { id, data, version } or
// { id, error, version } (see svg-optimizer-run.js).
import * as svgo from 'svgo/browser';
import { runSvgo } from './svg-optimizer-run.js';

self.onmessage = (event) => {
  const { id, text, config } = event.data || {};
  self.postMessage({ id, ...runSvgo(svgo, text, config) });
};
