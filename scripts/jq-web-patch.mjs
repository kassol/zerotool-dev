// Source patch for jq-web 0.6.2 (jq 1.7.1 compiled with Emscripten), applied by
// sync-jq-web.mjs when it copies jq.js to public/jq-web/, and by test-jq-playground.mjs.
//
// Read:  nothing (pure function on the jq.js source text)
// Write: nothing
//
// jq-web's raw() returns only stdout and throws on a non-zero exit code. When a filter prints
// some values and then fails (`.[] | .a` on `[{"a":1}, 2]`), the jq CLI prints the values and
// then the error; jq-web drops the values. Messages from `debug` / `stderr` on success go to
// console.warn only. raw() also rewrites `--argjson NAME TEXT` into `--slurpfile` plus a
// `$NAME[0] as $NAME |` prefix on the filter, so `$ARGS.named.NAME` becomes `[value]` and
// compile errors quote the changed filter, while jq 1.7.1 reads --argjson itself.
//
// jq-web also names the input file "inputString" and argv[0] "./this.program" (in Node, the
// script path), so error messages read "(at inputString:1)" and input_filename returns
// "inputString". The patch names them `input.json` and `jq`, as in `jq FILTER input.json`.
//
// The patch keeps raw() as it is for these cases and adds run(input, filter, flags), which
// returns { stdout, stderr, exitCode, fatal } with stdout and stderr byte-exact (no trailing
// newline removed). Each replacement must match exactly once; otherwise the build stops, so a
// jq-web upgrade cannot silently skip a patch.

export const JQ_WEB_VERSION = '0.6.2';

export const INPUT_FILE = 'input.json';

export const PATCHES = [
  {
    name: 'program name jq',
    find: "  args.unshift(thisProgram);",
    replace: "  args.unshift('jq');",
  },
  {
    name: 'input file name (write)',
    find: 'FS.writeFile("inputString", jsonstring);',
    replace: 'FS.writeFile("' + INPUT_FILE + '", jsonstring);',
  },
  {
    name: 'input file name (argv)',
    find: 'flags.concat(filter, "inputString")',
    replace: 'flags.concat(filter, "' + INPUT_FILE + '")',
  },
  {
    name: 'native --argjson',
    find: 'if (flags[i] !== "--argjson") {',
    replace: 'if (true) {',
  },
  {
    name: 'keep exact stdout and stderr',
    find: '  if (errBuffer.length) {\n    stderr = fromByteArray(errBuffer).trim();\n  }',
    replace: '  lastRun = { stdout: utf8Decoder.decode(new Uint8Array(outBuffer)), stderr: utf8Decoder.decode(new Uint8Array(errBuffer)), exitCode: exitCode };\n  outBuffer = [];\n  errBuffer = [];\n  if (lastRun.stderr) {\n    stderr = lastRun.stderr.trim();\n  }',
  },
  {
    name: 'stdout from lastRun',
    find: '  if (outBuffer.length) {\n    stdout = fromByteArray(outBuffer);\n  }',
    replace: '  if (lastRun.stdout) {\n    stdout = lastRun.stdout.replace(/\\n$/, "");\n  }',
  },
  {
    name: 'no console.warn on success',
    find: "      console.warn('%cstderr%c: %c%s', 'background:red;color:black', '', 'color:red', stderr);",
    replace: '      // stderr is returned by run()',
  },
  {
    name: 'add run()',
    find: '// takes an object as input and tries to return objects.',
    replace: [
      'var lastRun = { stdout: "", stderr: "", exitCode: 0 };',
      'function runJq(jsonstring, filter, flags) {',
      '  lastRun = { stdout: "", stderr: "", exitCode: 0 };',
      '  try {',
      '    raw(jsonstring, filter, (flags || []).slice());',
      '    return { stdout: lastRun.stdout, stderr: lastRun.stderr, exitCode: lastRun.exitCode || 0, fatal: null };',
      '  } catch (e) {',
      '    var code = e && typeof e.exitCode === "number" ? e.exitCode : null;',
      '    return { stdout: lastRun.stdout, stderr: lastRun.stderr, exitCode: code, fatal: code === null ? String(e && e.message || e) : null };',
      '  }',
      '}',
      '',
      '// takes an object as input and tries to return objects.',
    ].join('\n'),
  },
  {
    name: 'export run()',
    find: '    { json, raw },',
    replace: '    { json, raw, runJq },',
  },
  {
    name: 'expose run()',
    find: '  return { json: module.json, raw: module.raw };',
    replace: '  return { json: module.json, raw: module.raw, run: module.runJq };',
  },
];

export function patchJqWeb(source) {
  let out = source;
  for (const p of PATCHES) {
    const first = out.indexOf(p.find);
    if (first < 0 || out.indexOf(p.find, first + 1) >= 0) {
      throw new Error('jq-web patch "' + p.name + '" must match exactly once (found ' + (first < 0 ? 0 : 'more than one') + ')');
    }
    out = out.slice(0, first) + p.replace + out.slice(first + p.find.length);
  }
  return out;
}
