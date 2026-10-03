// Read the installed smol-toml parser. Write stdout/stderr only.
// Each EOF regression runs in a child with SIGKILL timeout (GHSA-7w5x-hrqm-74c2).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, stringify, TomlError } from 'smol-toml';

const inputs = ['a=[1 #', 'a=[1, #', 'a={b=1, #', 'a=[{b=1}, #'];
if (process.argv[2] === '--case') {
  const input = inputs[Number(process.argv[3])];
  const start = performance.now();
  assert.throws(() => parse(input), TomlError);
  const valid = parse('title="中文 日本語 한글"\na=[1, # comment\n2]\nconfig={enabled=true}');
  assert.deepEqual(valid, { title: '中文 日本語 한글', a: [1, 2], config: { enabled: true } });
  assert.deepEqual(parse(stringify(valid)), valid);
  console.log(`PASS ${JSON.stringify(input)} rejected; valid parse and round trip recovered (${(performance.now() - start).toFixed(1)} ms)`);
} else {
  let failures = 0;
  for (let i = 0; i < inputs.length; i++) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--case', String(i)], {
      encoding: 'utf8', timeout: process.env.CI ? 8000 : 2000, killSignal: 'SIGKILL',
    });
    if (child.status !== 0) {
      failures++;
      console.error(`FAIL ${JSON.stringify(inputs[i])}: ${child.error?.code || child.signal || child.status}\n${child.stderr}`);
    } else process.stdout.write(child.stdout);
  }
  console.log(`TOML parser security: ${inputs.length - failures} passed, ${failures} failures`);
  process.exitCode = failures ? 1 : 0;
}
