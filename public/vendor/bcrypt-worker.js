// Web Worker for the Bcrypt Generator (src/components/tools/BcryptGeneratorTool.astro).
// Runs bcryptjs off the main thread. Every reply carries the id of the message it answers.
//   { id, type: 'bench', cost }          -> { id, type: 'result', ms }
//   { id, type: 'hash', password, salt } -> { id, type: 'progress', p } … { id, type: 'result', hash, ms }
// Errors come back as { id, type: 'error', message }. Tested by scripts/test-bcrypt-generator.mjs.
// Cached pages from before v1.138.56 still send generate / verify.
importScripts('/vendor/bcryptjs.min.js');

var bcrypt = self.dcodeIO.bcrypt;

function now() { return self.performance && self.performance.now ? self.performance.now() : Date.now(); }

self.onmessage = function (e) {
  var d = e.data || {}, id = d.id;
  try {
    if (d.type === 'generate') {
      self.postMessage({ id: id, type: 'result', hash: bcrypt.hashSync(d.password, d.rounds) });
    } else if (d.type === 'verify') {
      self.postMessage({ id: id, type: 'result', match: bcrypt.compareSync(d.password, d.hash) });
    } else if (d.type === 'bench') {
      var cost = d.cost || 8;
      bcrypt.hashSync('warm-up', '$2b$04$abcdefghijklmnopqrstuu');
      var t0 = now();
      bcrypt.hashSync('benchmark', '$2b$' + (cost < 10 ? '0' : '') + cost + '$abcdefghijklmnopqrstuu');
      self.postMessage({ id: id, type: 'result', ms: now() - t0 });
    } else if (d.type === 'hash') {
      var t1 = now(), last = 0;
      bcrypt.hash(d.password, d.salt, function (err, hash) {
        if (err) self.postMessage({ id: id, type: 'error', message: err.message || String(err) });
        else self.postMessage({ id: id, type: 'result', hash: hash, ms: now() - t1 });
      }, function (p) {
        var t = now();
        if (t - last > 80) { last = t; self.postMessage({ id: id, type: 'progress', p: p }); }
      });
    } else {
      self.postMessage({ id: id, type: 'error', message: 'unknown message type' });
    }
  } catch (err) {
    self.postMessage({ id: id, type: 'error', message: (err && err.message) || String(err) });
  }
};
