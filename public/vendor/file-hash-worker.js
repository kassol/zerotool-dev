// file-hash-checker worker: hashes one File / Blob with one algorithm, reading it as a
// stream so memory stays near one chunk whatever the file size. Loaded by
// src/components/tools/FileHashCheckerTool.astro, one worker per algorithm.
// Messages in:  { id, file, algo }   algo: MD5 | SHA-1 | SHA-256 | SHA-384 | SHA-512 | CRC32
// Messages out: { id, type: 'progress', done } · { id, type: 'done', hex } · { id, type: 'error', name, message }
// Nothing is sent over the network; the file is read from disk by the browser only.
importScripts('/vendor/hash-wasm.min.js');

/* ── engine:start ── */
var FHW_CHUNK = 1048576;
var FHW_PROGRESS_EVERY = 16 * 1048576;
var FHW_CREATE = {
  'MD5': 'createMD5', 'SHA-1': 'createSHA1', 'SHA-256': 'createSHA256',
  'SHA-384': 'createSHA384', 'SHA-512': 'createSHA512', 'CRC32': 'createCRC32'
};

// Returns the lowercase hex digest. onProgress(bytesDone) is called about every 16 MB.
// A BYOB reader refills one 1 MB buffer, so reading a 4 GB file allocates almost nothing;
// streams without BYOB support fall back to the default reader.
async function hashBlob(blob, algo, onProgress) {
  var factory = FHW_CREATE[algo];
  if (!factory) throw new Error('Unsupported algorithm: ' + algo);
  var hasher = await hashwasm[factory]();
  hasher.init();
  var stream = blob.stream();
  var reader = null;
  var byob = false;
  try { reader = stream.getReader({ mode: 'byob' }); byob = true; } catch (e) { reader = stream.getReader(); }
  var done = 0;
  var nextReport = FHW_PROGRESS_EVERY;
  var buf = new ArrayBuffer(FHW_CHUNK);
  for (;;) {
    var r = byob ? await reader.read(new Uint8Array(buf)) : await reader.read();
    if (r.done) break;
    var chunk = r.value;
    hasher.update(chunk);
    done += chunk.byteLength;
    if (byob) buf = chunk.buffer;
    if (onProgress && done >= nextReport) { onProgress(done); nextReport = done + FHW_PROGRESS_EVERY; }
  }
  if (done !== blob.size) throw new Error('Read ' + done + ' of ' + blob.size + ' bytes; the file changed while it was being read.');
  if (onProgress) onProgress(done);
  return hasher.digest('hex');
}
/* ── engine:end ── */

self.onmessage = function (e) {
  var msg = e.data || {};
  hashBlob(msg.file, msg.algo, function (n) { self.postMessage({ id: msg.id, type: 'progress', done: n }); })
    .then(function (hex) { self.postMessage({ id: msg.id, type: 'done', hex: hex }); })
    .catch(function (err) {
      self.postMessage({ id: msg.id, type: 'error', name: (err && err.name) || 'Error', message: (err && err.message) || String(err) });
    });
};
