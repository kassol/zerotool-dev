// Docker run to Compose — every docker run option is parsed with its value, named volumes are declared
//
// Read:  src/components/tools/DockerToComposeTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/content/tools/docker-to-compose/{en,zh,ja,ko}.mdx
//        (each ```bash block that is followed by a ```yaml block must convert to that YAML)
// Write: stdout; temporary compose projects under os.tmpdir() (removed at the end)
// Exit:  0 if all PASS, 1 if any FAIL
//
// The option table follows `docker run --help` of Docker CLI 29.4: options that take a value
// consume the next token (or the text after `=`, or the rest of a short-option group), so a
// value is never read as the image name. Options with a Compose service key are converted
// (Compose Specification, services reference); the rest are listed as not converted. Named
// volumes in -v are declared in a top-level `volumes:` section. When `docker compose` is
// installed (local Docker Desktop, GitHub ubuntu runners), every generated file is checked
// with `docker compose config`; without it those checks are SKIP.
//
// Run: node scripts/test-docker-to-compose.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/DockerToComposeTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in DockerToComposeTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { parseDockerRun, generateCompose };')();

let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}

function convert(cmd) {
  const parsed = E.parseDockerRun(cmd);
  if (!parsed || parsed.error) return { parsed, yaml: null, doc: null };
  const text = E.generateCompose(parsed);
  return { parsed, yaml: text, doc: yaml.load(text) };
}
function service(doc) {
  const names = Object.keys(doc.services);
  return doc.services[names[0]];
}

// ---------- docker compose config ----------
const compose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
const haveCompose = compose.status === 0;
if (!haveCompose) console.log('SKIP: docker compose not installed; generated files are only parsed with js-yaml');
const tmp = mkdtempSync(join(tmpdir(), 'dtc-test-'));
writeFileSync(join(tmp, '.env'), 'A=1\n');
writeFileSync(join(tmp, 'app.env'), 'B=2\n');
let projectCount = 0;
function composeAccepts(name, text) {
  if (!haveCompose) { skips++; return; }
  const file = join(tmp, 'compose-' + (++projectCount) + '.yaml');
  writeFileSync(file, text);
  const r = spawnSync('docker', ['compose', '-f', file, '--project-directory', tmp, 'config', '--quiet'], { encoding: 'utf8' });
  check('docker compose config accepts: ' + name, r.status === 0, (r.stderr || r.stdout).trim() + '\n' + text);
}

// ---------- the reported defect: a value read as the image name ----------
{
  const r = convert('docker run --env-file .env nginx');
  eq('--env-file value is not the image', r.doc && service(r.doc).image, 'nginx');
  eq('--env-file becomes env_file', r.doc && service(r.doc).env_file, ['.env']);
  composeAccepts('--env-file', r.yaml);
}
{
  const r = convert('docker run -d --name web --entrypoint /bin/sh -u 1000 -w /app nginx -c "echo hello"');
  const s = r.doc && service(r.doc);
  eq('--entrypoint value is not the image', s && s.image, 'nginx');
  eq('--entrypoint becomes a one-item list', s && s.entrypoint, ['/bin/sh']);
  eq('-u becomes user', s && s.user, '1000');
  eq('-w becomes working_dir', s && s.working_dir, '/app');
  eq('arguments after the image become command', s && s.command, ['-c', 'echo hello']);
  check('--name is the service key', r.doc && 'web' in r.doc.services);
  composeAccepts('entrypoint / user / workdir', r.yaml);
}
{
  const r = convert('docker run --gpus all --log-opt max-size=10m --sig-proxy=false nginx:1.27');
  const s = r.doc && service(r.doc);
  eq('an option without a Compose key still consumes its value', s && s.image, 'nginx:1.27');
  eq('options without a Compose key are listed', r.parsed && r.parsed.unconverted, ['--gpus all', '--log-opt max-size=10m', '--sig-proxy=false']);
  check('the YAML lists them in a comment', r.yaml && r.yaml.startsWith('# Not converted: --gpus all, --log-opt max-size=10m, --sig-proxy=false\n'), r.yaml);
  composeAccepts('unconverted options', r.yaml);
}
for (const flag of ['--cpu-shares', '--hostname', '-h', '--label', '-l', '--add-host', '--pull', '--platform', '--mount', '--ulimit', '--health-cmd', '--network-alias', '--ip', '--link', '--log-driver', '--stop-timeout']) {
  const r = convert('docker run ' + flag + ' x=1 alpine echo hi');
  eq('value of ' + flag + ' is consumed', r.doc && service(r.doc).image, 'alpine');
}
{
  const r = E.parseDockerRun('docker run --no-such-flag value nginx');
  eq('an unknown option is an error, as in docker', r && r.error, 'unknownFlag');
  eq('the error names the option', r && r.flag, '--no-such-flag');
  eq('unknown short option', E.parseDockerRun('docker run -Z nginx').flag, '-Z');
  eq('missing value at the end', E.parseDockerRun('docker run nginx --name').error, undefined);
  eq('option value missing', E.parseDockerRun('docker run --name').error, 'missingValue');
  eq('no image', E.parseDockerRun('docker run -d'), null);
}

// ---------- the reported defect: named volumes not declared ----------
{
  const r = convert('docker run -d --name postgres -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql/data postgres:16-alpine');
  eq('named volume is declared at the top level', r.doc && r.doc.volumes, { pgdata: null });
  composeAccepts('named volume', r.yaml);
}
{
  const r = convert('docker run -v ./site:/usr/share/nginx/html:ro -v /etc/hosts:/etc/hosts -v ~/cfg:/cfg -v /cache -v logs:/var/log/nginx -v logs:/backup:ro -v my.vol_2:/m nginx');
  eq('only named volumes are declared, once each', r.doc && r.doc.volumes, { logs: null, 'my.vol_2': null });
  eq('all mounts are kept on the service', r.doc && service(r.doc).volumes.length, 7);
  composeAccepts('bind, anonymous and named volumes', r.yaml.replace('~/cfg', './cfg'));
}
{
  const r = convert('docker run --volume=data:/d --volumes-from other nginx');
  eq('--volume= form is declared too', r.doc && r.doc.volumes, { data: null });
  eq('--volumes-from becomes volumes_from', r.doc && service(r.doc).volumes_from, ['other']);
}

// ---------- command forms ----------
eq('docker container run is accepted', convert('docker container run -d nginx').doc && service(convert('docker container run -d nginx').doc).image, 'nginx');
eq('bare run is accepted', service(convert('run nginx').doc).image, 'nginx');
eq('backslash continuations', service(convert('docker run \\\n  -p 80:80 \\\n  nginx').doc).ports, ['80:80']);
{
  const s = service(convert('docker run -dit --rm ubuntu bash').doc);
  eq('-dit: -i and -t become stdin_open and tty', [s.stdin_open, s.tty], [true, true]);
  eq('-dit: image and command', [s.image, s.command], ['ubuntu', ['bash']]);
}
{
  const s = service(convert('docker run -dp 8080:80 -p80:81 -e=A=1 -eB=2 nginx').doc);
  eq('a short option at the end of a group takes the next token', s.ports, ['8080:80', '80:81']);
  eq('-e=A=1 and -eB=2', s.environment, ['A=1', 'B=2']);
}
{
  const s = service(convert('docker run --privileged --init --read-only --tmpfs /run --cap-drop ALL --cap-add=NET_BIND_SERVICE --shm-size 1g --pids-limit 100 --security-opt no-new-privileges --dns 1.1.1.1 --add-host db:10.0.0.2 -l app=web --label=tier=front --expose 9000 --device /dev/fuse --stop-signal SIGINT --platform linux/amd64 --pull always -h box --restart no busybox').doc);
  eq('booleans', [s.privileged, s.init, s.read_only], [true, true, true]);
  eq('lists', [s.tmpfs, s.cap_drop, s.cap_add, s.security_opt, s.dns, s.extra_hosts, s.labels, s.expose, s.devices],
    [['/run'], ['ALL'], ['NET_BIND_SERVICE'], ['no-new-privileges'], ['1.1.1.1'], ['db:10.0.0.2'], ['app=web', 'tier=front'], ['9000'], ['/dev/fuse']]);
  eq('scalars', [s.shm_size, s.pids_limit, s.stop_signal, s.platform, s.pull_policy, s.hostname, s.restart],
    ['1g', 100, 'SIGINT', 'linux/amd64', 'always', 'box', 'no']);
}
{
  const r = convert('docker run --privileged --init --read-only --tmpfs /run --cap-drop ALL --shm-size 1g --pids-limit 100 --security-opt no-new-privileges --dns 1.1.1.1 --add-host db:10.0.0.2 -l app=web --expose 9000 --stop-signal SIGINT --platform linux/amd64 --pull always -h box --restart no busybox');
  composeAccepts('booleans, lists and scalars', r.yaml);
}

// ---------- networks ----------
{
  const r = convert('docker run --network host nginx');
  eq('--network host becomes network_mode', service(r.doc).network_mode, 'host');
  eq('no top-level network for host', r.doc.networks, undefined);
  composeAccepts('network_mode host', r.yaml);
  eq('--network none', service(convert('docker run --network=none nginx').doc).network_mode, 'none');
  eq('--network container:x', service(convert('docker run --net container:db nginx').doc).network_mode, 'container:db');
}
{
  const r = convert('docker run --network app-net nginx');
  eq('user network', [service(r.doc).networks, r.doc.networks], [['app-net'], { 'app-net': { external: true } }]);
  composeAccepts('external network', r.yaml);
}

// ---------- YAML values that need quotes ----------
{
  const r = convert('docker run -e FLAG=yes -h 123 --restart no -l "note=a: b # c" --entrypoint "" nginx echo "\\"quoted\\""');
  const s = service(r.doc);
  eq('hostname of digits stays a string', s.hostname, '123');
  eq('restart no stays a string', s.restart, 'no');
  eq('label with ": " and " #"', s.labels, ['note=a: b # c']);
  eq('empty entrypoint', s.entrypoint, ['']);
  eq('quotes inside a command argument', s.command, ['echo', '"quoted"']);
  composeAccepts('values that need quotes', r.yaml);
}

// ---------- the examples on the tool pages ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/docker-to-compose/' + lang + '.mdx'), 'utf8');
  const re = /```bash\n([\s\S]*?)\n```\s*\n(?:[^`]*\n)?```yaml\n([\s\S]*?)\n```/g;
  let m;
  let count = 0;
  while ((m = re.exec(mdx))) {
    count++;
    const out = E.generateCompose(E.parseDockerRun(m[1]));
    eq(lang + ': example ' + count + ' output matches the page', out, m[2]);
    composeAccepts(lang + ' example ' + count, out);
  }
  check(lang + ': page has at least two examples', count >= 2, String(count));
}

// ---------- status messages ----------
{
  const m = source.match(/var STRINGS = (\{[\s\S]*?\n      \});/);
  check('STRINGS block found', !!m);
  if (m) {
    const S = new Function('return ' + m[1])();
    const keys = Object.keys(S.en).sort().join();
    for (const lang of ['zh', 'ja', 'ko']) eq(lang + ': same STRINGS keys as en', Object.keys(S[lang]).sort().join(), keys);
    for (const lang of ['en', 'zh', 'ja', 'ko']) {
      check(lang + ': unknown-option message has {flag}', S[lang].msgUnknownFlag.includes('{flag}') && S[lang].msgMissingValue.includes('{flag}'));
      check(lang + ': not-converted message has {flags}', S[lang].msgNotConverted.includes('{flags}'));
    }
  }
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passes} passed, ${failures} failed` + (skips ? `, ${skips} skipped` : ''));
process.exit(failures ? 1 : 0);
