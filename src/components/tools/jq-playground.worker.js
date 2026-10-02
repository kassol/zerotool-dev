// jq Playground worker (classic worker, not bundled). scripts/sync-jq-web.mjs copies this file to
// public/jq-web/jq-worker.js next to the patched jq.js and jq.wasm.
//
// jq runs synchronously; in a worker a long filter does not freeze the page, and the page can
// stop a filter that never ends (repeat, recurse without a limit) by terminating the worker.
//
// Message in:  { id, input, filter, flags }
// Message out: { type: 'ready' } once jq.wasm is compiled,
//              { type: 'loadError', message },
//              { type: 'result', id, stdout, stderr, exitCode, fatal, ms }
/* global importScripts, jq */
importScripts('jq.js');

var ready = self.jq.then(function (engine) {
  self.postMessage({ type: 'ready' });
  return engine;
}, function (err) {
  self.postMessage({ type: 'loadError', message: String((err && err.message) || err) });
  throw err;
});

self.onmessage = function (event) {
  var req = event.data || {};
  ready.then(function (engine) {
    var t0 = performance.now();
    var r = engine.run(String(req.input), String(req.filter), (req.flags || []).slice());
    self.postMessage({
      type: 'result',
      id: req.id,
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exitCode,
      fatal: r.fatal,
      ms: performance.now() - t0,
    });
  }, function () {});
};
