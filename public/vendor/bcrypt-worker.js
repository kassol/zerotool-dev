importScripts('/vendor/bcryptjs.min.js');

self.onmessage = function (e) {
  var data = e.data;
  try {
    if (data.type === 'generate') {
      var hash = dcodeIO.bcrypt.hashSync(data.password, data.rounds);
      self.postMessage({ id: data.id, type: 'result', hash: hash });
    } else if (data.type === 'verify') {
      var match = dcodeIO.bcrypt.compareSync(data.password, data.hash);
      self.postMessage({ id: data.id, type: 'result', match: match });
    }
  } catch (err) {
    self.postMessage({ id: data.id, type: 'error', message: err.message || String(err) });
  }
};
