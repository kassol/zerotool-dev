// SSL Certificate Decoder — X.509 (RFC 5280) parsing, PEM / DER / PKCS #7 input, chain checks
//
// Read:  src/components/tools/SslCertificateDecoderTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers, the STRINGS table between `strings:start` /
//        `strings:end`, and the EXAMPLES table), scripts/test-ssl-certificate-decoder.fixtures.json
//        (certificates made by scripts/gen-ssl-certificate-decoder-fixtures.mjs with OpenSSL 3.6,
//        and the chains 6 public sites sent on the date in the file), src/content/tools/
//        ssl-certificate-decoder/*.mdx (quoted example values).
// Write: temporary PEM files under os.tmpdir() for `openssl` (deleted at exit); stdout.
// Exit:  0 if all PASS, 1 if any FAIL.
//
// With `openssl` on PATH (CI: Ubuntu, OpenSSL 3.0) every fixture certificate is compared field by
// field with the output of `openssl x509` (-serial, -fingerprint, -dates, -subject / -issuer with
// -nameopt RFC2253, -ext subjectAltName, -pubkey, -text for key size, curve, exponent, signature
// algorithm, extension list with critical flags, Key Usage, Extended Key Usage, Basic Constraints,
// key identifiers and SCTs), and every chain link is checked with `openssl verify -partial_chain`.
// Without openssl these comparisons are SKIPPED. The ML-DSA certificate needs OpenSSL 3.5+.
// The -text key size line is read in both the OpenSSL 3.x and the 4.0 format (see below).
// Certificates for structural edge cases (v1, time encodings, serial numbers, string types,
// duplicate / unknown critical extensions, CA flags, path length) are built in memory with a
// small DER encoder and signed with keys that node:crypto generates for this run only.
//
// Run: node scripts/test-ssl-certificate-decoder.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign as nodeSign, randomBytes } from 'node:crypto';
import { domainToUnicode } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/SslCertificateDecoderTool.astro'), 'utf8');
const fx = JSON.parse(readFileSync(join(root, 'scripts/test-ssl-certificate-decoder.fixtures.json'), 'utf8'));

function between(a, b) {
  const i = source.indexOf(a), j = source.indexOf(b);
  if (i < 0 || j <= i) { console.error('FAIL: markers ' + a + ' / ' + b + ' not found'); process.exit(1); }
  return source.slice(i, j);
}
const block = between('/* ── engine:start ── */', '/* ── engine:end ── */');
const E = new Function(block + `
return { parseInput, decodeCertificate, analyzeChain, checkCertificate, fingerprints, nameToString, matchHostname,
  validityDays, verifySignature, formatIp, punycodeDecode, idnToUnicode, md5, classifyDer, pkcs7Certificates, toPem,
  validityStatus, normalizeHost, bytesToHex, brMaxDays };`)();
const STRINGS = new Function(between('/* ── strings:start ── */', '/* ── strings:end ── */').replace('/* ── strings:start ── */', '') + '\nreturn STRINGS;')();
const exStart = source.indexOf('const EXAMPLES = {');
const EXAMPLES = new Function(source.slice(exStart, source.indexOf('\n};', exStart) + 3) + '\nreturn EXAMPLES;')();

let passes = 0, failures = 0, skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' (' + why + ')'); }
function throwsCode(name, fn, code, params) {
  try { fn(); check(name, false, 'no error'); }
  catch (e) {
    if (!e.scd) { check(name, false, 'non-engine error ' + e.message); return; }
    check(name + ' code', e.code === code, 'got ' + e.code + ' ' + JSON.stringify(e.params));
    if (params) for (const k of Object.keys(params)) eq(name + ' ' + k, e.params[k], params[k]);
  }
}
const subtle = globalThis.crypto.subtle;
const NOW = Date.UTC(2026, 9, 1);
const decodeOne = (pem) => E.decodeCertificate(E.parseInput(pem).certs[0].der);
const decodeAll = (pem) => E.parseInput(pem).certs.map((c) => E.decodeCertificate(c.der));
const pemBody = (pem) => Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');

// ── 1. Fixture certificates against OpenSSL ──
let opensslVersion = null;
try { opensslVersion = execFileSync('openssl', ['version'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { /* none */ }
const tmp = mkdtempSync(join(tmpdir(), 'scd-test-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const versionNum = opensslVersion ? (opensslVersion.match(/OpenSSL (\d+)\.(\d+)/) || []).slice(1).map(Number) : null;
const hasMlDsa = versionNum && (versionNum[0] > 3 || (versionNum[0] === 3 && versionNum[1] >= 5));

const OSSL_SIG = { sha256WithRSAEncryption: '1.2.840.113549.1.1.11', sha384WithRSAEncryption: '1.2.840.113549.1.1.12',
  sha512WithRSAEncryption: '1.2.840.113549.1.1.13', sha1WithRSAEncryption: '1.2.840.113549.1.1.5',
  'ecdsa-with-SHA256': '1.2.840.10045.4.3.2', 'ecdsa-with-SHA384': '1.2.840.10045.4.3.3', 'ecdsa-with-SHA512': '1.2.840.10045.4.3.4',
  rsassaPss: '1.2.840.113549.1.1.10', ED25519: '1.3.101.112', 'ML-DSA-65': '2.16.840.1.101.3.4.3.18' };
const OSSL_EXT = { 'X509v3 Basic Constraints': '2.5.29.19', 'X509v3 Key Usage': '2.5.29.15', 'X509v3 Extended Key Usage': '2.5.29.37',
  'X509v3 Subject Key Identifier': '2.5.29.14', 'X509v3 Authority Key Identifier': '2.5.29.35', 'X509v3 Subject Alternative Name': '2.5.29.17',
  'Authority Information Access': '1.3.6.1.5.5.7.1.1', 'X509v3 CRL Distribution Points': '2.5.29.31', 'X509v3 Certificate Policies': '2.5.29.32',
  'X509v3 Name Constraints': '2.5.29.30', 'TLS Feature': '1.3.6.1.5.5.7.1.24', 'CT Precertificate SCTs': '1.3.6.1.4.1.11129.2.4.2' };
const OSSL_KU = { 'Digital Signature': 'digitalSignature', 'Non Repudiation': 'nonRepudiation', 'Key Encipherment': 'keyEncipherment',
  'Data Encipherment': 'dataEncipherment', 'Key Agreement': 'keyAgreement', 'Certificate Sign': 'keyCertSign', 'CRL Sign': 'cRLSign',
  'Encipher Only': 'encipherOnly', 'Decipher Only': 'decipherOnly' };
const OSSL_EKU = { 'TLS Web Server Authentication': 'serverAuth', 'TLS Web Client Authentication': 'clientAuth',
  'Code Signing': 'codeSigning', 'E-mail Protection': 'emailProtection', 'Time Stamping': 'timeStamping', 'OCSP Signing': 'OCSPSigning' };

function ossl(args, file) {
  return execFileSync('openssl', [...args, '-in', file], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}
function expandIp(s) {
  if (s.indexOf(':') < 0) return s;
  return new URL('http://[' + s + ']/').hostname.slice(1, -1);
}

function compareWithOpenssl(label, pem) {
  const file = join(tmp, label.replace(/[^a-z0-9.-]/gi, '_') + '.pem');
  writeFileSync(file, pem);
  const c = decodeOne(pem);
  eq(label + ' serial', c.serial.hex, ossl(['x509', '-noout', '-serial'], file).trim().replace(/^serial=/, ''));
  for (const [alg, key] of [['sha256', 'sha256'], ['sha1', 'sha1'], ['md5', 'md5']]) {
    const want = ossl(['x509', '-noout', '-fingerprint', '-' + alg], file).trim().split('=')[1];
    const got = alg === 'md5' ? E.bytesToHex(E.md5(c.der)) : E.bytesToHex(new Uint8Array(createHash(alg).update(c.der).digest()));
    eq(label + ' ' + key + ' fingerprint', got, want);
  }
  const dates = ossl(['x509', '-noout', '-startdate', '-enddate'], file);
  eq(label + ' notBefore', c.notBefore.ms, Date.parse(dates.match(/notBefore=(.*)/)[1]));
  eq(label + ' notAfter', c.notAfter.ms, Date.parse(dates.match(/notAfter=(.*)/)[1]));
  eq(label + ' subject', E.nameToString(c.subject), ossl(['x509', '-noout', '-subject', '-nameopt', 'RFC2253,-esc_msb'], file).trim().replace(/^subject=/, ''));
  eq(label + ' issuer', E.nameToString(c.issuer), ossl(['x509', '-noout', '-issuer', '-nameopt', 'RFC2253,-esc_msb'], file).trim().replace(/^issuer=/, ''));
  // SAN
  const sanExt = c.ext['2.5.29.17'];
  let sanText = '';
  try { sanText = ossl(['x509', '-noout', '-ext', 'subjectAltName'], file).split('\n').slice(1).join(' ').trim(); } catch (e) { /* none */ }
  if (sanExt) {
    const want = sanText.split(/, (?=(?:DNS|IP Address|email|URI|othername|DirName|Registered ID):)/).map((x) => x.trim()).filter(Boolean).map((x) => {
      const m = x.match(/^(DNS|IP Address|email|URI|othername|DirName|Registered ID):\s?(.*)$/);
      const type = { DNS: 'DNS', 'IP Address': 'IP', email: 'email', URI: 'URI', othername: 'otherName', DirName: 'DirName', 'Registered ID': 'RID' }[m[1]];
      let v = m[2];
      if (type === 'IP') v = expandIp(v.toLowerCase());
      if (type === 'otherName') v = v.replace(/^UPN:{1,2}/, '');
      if (type === 'DirName') v = v.replace(/^\//, '').split('/').reverse().join(',');
      return type + '=' + v;
    });
    const got = sanExt.decoded.names.map((g) => g.type + '=' + (g.type === 'IP' ? expandIp(g.value) : g.type === 'otherName' ? g.value : g.value));
    eq(label + ' SAN', got, want);
  } else check(label + ' no SAN', sanText === '', sanText);
  // SPKI pin
  const pub = ossl(['x509', '-noout', '-pubkey'], file);
  eq(label + ' SPKI bytes', Buffer.from(c.spki.raw).toString('base64'), pemBody(pub).toString('base64'));
  // -text facts
  const text = ossl(['x509', '-noout', '-text'], file);
  eq(label + ' version', 'Version: ' + c.version, (text.match(/Version: (\d+)/) || [])[0]);
  const sigName = (text.match(/Signature Algorithm: (\S+)/) || [])[1];
  eq(label + ' signature algorithm', c.sigAlg.oid, OSSL_SIG[sigName] || sigName);
  // OpenSSL 3.x prints "Public-Key: (256 bit)". From 4.0 the EC line is
  // "Public-Key: (256 bit field, 128 bit security level)": the field degree replaces the bit count
  // of the group order (commit e57f7941af, openssl/openssl#29539). For the named curves in the
  // fixtures both numbers are the same; RSA keys keep the old form.
  const keyLine = text.match(/Public-Key: \(([^)\n]*)\)/);
  const bits = keyLine && keyLine[1].match(/^(\d+) bit(?: field, \d+ bit security level)?$/);
  if (keyLine && !bits) check(label + ' key bits line recognized', false, keyLine[0]);
  eq(label + ' key bits', c.spki.bits || null, bits ? Number(bits[1]) : null);
  const curve = text.match(/ASN1 OID: (\S+)/);
  eq(label + ' curve', c.spki.curveAlias || null, curve ? curve[1] : null);
  const expo = text.match(/Exponent: (\d+)/);
  eq(label + ' exponent', c.spki.exponent || null, expo ? expo[1] : null);
  const extBlock = (text.split('X509v3 extensions:')[1] || '').split(/\n {4}Signature Algorithm/)[0];
  const headers = [...extBlock.matchAll(/^ {12}(\S[^\n]*?):( critical)?\s*$/gm)].map((m) => (OSSL_EXT[m[1]] || m[1]) + (m[2] ? '!' : ''));
  eq(label + ' extensions', c.extensions.map((e) => e.oid + (e.critical ? '!' : '')), headers);
  const valueAfter = (title) => { const m = extBlock.match(new RegExp(title + ':( critical)?\\s*\\n\\s+([^\\n]+)')); return m ? m[2].trim() : null; };
  const ku = c.ext['2.5.29.15'];
  if (ku) eq(label + ' key usage', ku.decoded.flags, valueAfter('X509v3 Key Usage').split(', ').map((x) => OSSL_KU[x]));
  const eku = c.ext['2.5.29.37'];
  if (eku) eq(label + ' EKU', eku.decoded.usages.map((u) => u.name), valueAfter('X509v3 Extended Key Usage').split(', ').map((x) => OSSL_EKU[x] || x));
  const bc = c.ext['2.5.29.19'];
  if (bc) eq(label + ' basic constraints', 'CA:' + (bc.decoded.ca ? 'TRUE' : 'FALSE') + (bc.decoded.pathLen != null ? ', pathlen:' + bc.decoded.pathLen : ''), valueAfter('X509v3 Basic Constraints'));
  const ski = c.ext['2.5.29.14'];
  if (ski) eq(label + ' SKI', ski.decoded.keyId, valueAfter('X509v3 Subject Key Identifier'));
  const aki = c.ext['2.5.29.35'];
  if (aki) eq(label + ' AKI', aki.decoded.keyId, valueAfter('X509v3 Authority Key Identifier').replace(/^keyid:/, ''));
  const sct = c.ext['1.3.6.1.4.1.11129.2.4.2'];
  if (sct) {
    const logIds = [...text.matchAll(/Log ID\s+: ([0-9A-F:]+)\s*\n\s+([0-9A-F:]+)/g)].map((m) => (m[1] + m[2]).replace(/:$/, ''));
    eq(label + ' SCT log IDs', sct.decoded.scts.map((s) => s.logIdHex), logIds);
    const stamps = [...text.matchAll(/Timestamp : (\w+ +\d+ [\d:]+)\.(\d{3}) (\d{4}) GMT/g)].map((m) => Date.parse(m[1] + ' ' + m[3] + ' GMT') + Number(m[2]));
    eq(label + ' SCT timestamps', sct.decoded.scts.map((s) => s.timestamp), stamps);
  }
  return c;
}

function verifyWithOpenssl(label, child, issuer) {
  const cf = join(tmp, 'v-child.pem'), isf = join(tmp, 'v-issuer.pem');
  writeFileSync(cf, E.toPem(child.der)); writeFileSync(isf, E.toPem(issuer.der));
  try {
    const out = execFileSync('openssl', ['verify', '-no_check_time', '-partial_chain', '-trusted', isf, cf], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return /: OK/.test(out);
  } catch (e) { return false; }
}

if (opensslVersion) {
  for (const [name, pem] of Object.entries(fx.certs)) {
    if (name === 'mldsa65' && !hasMlDsa) { skip('openssl compare mldsa65', opensslVersion + ' has no ML-DSA'); continue; }
    compareWithOpenssl('cert ' + name, pem);
  }
  for (const [host, pem] of Object.entries(fx.chains)) {
    pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g).forEach((p, i) => compareWithOpenssl(host + ' #' + (i + 1), p + '\n'));
  }
} else skip('openssl field comparison', 'openssl not on PATH');

// ── 2. Known values and regressions (independent of OpenSSL) ──
{
  const p521 = decodeOne(fx.certs.p521);
  eq('P-521 key size (old code: 528)', p521.spki.bits, 521);
  eq('P-521 curve', p521.spki.curve, 'P-521');
  const neg = decodeOne(fx.certs.negative);
  eq('negative serial hex (old code: "0-:30:39")', [neg.serial.hex, neg.serial.colon, neg.serial.decimal], ['-3039', '-30:39', '-12345']);
  check('negative serial warning', E.checkCertificate(neg, NOW).some((c) => c.code === 'serialNegative'));
  const pss = decodeOne(fx.certs.pss);
  eq('RSA-PSS key size (old code: none)', [pss.spki.kind, pss.spki.bits], ['rsa-pss', 2048]);
  eq('RSA-PSS signature parameters', pss.sigAlg.pss, { hash: 'SHA-256', mgf: 'MGF1', mgfHash: 'SHA-256', saltLength: 32, trailer: 1 });
  const ml = decodeOne(fx.certs.mldsa65);
  eq('ML-DSA-65 named with key length', [ml.spki.algorithm, ml.spki.pubBytes, ml.sigAlg.name], ['ML-DSA-65', 1952, 'ML-DSA-65']);
  const ed = decodeOne(fx.certs.ed25519);
  eq('Ed25519 key', [ed.spki.algorithm, ed.spki.pubBytes, ed.spki.bits], ['Ed25519', 32, null]);
  const long = decodeOne(fx.certs.long);
  eq('SAN keeps otherName, dirName and RID (old code dropped them)', long.ext['2.5.29.17'].decoded.names.map((g) => g.type + ':' + g.value),
    ['DNS:legacy.example.org', 'IP:198.51.100.7', 'IP:2001:db8::1:0:0:1', 'otherName:user@example.org', 'DirName:CN=legacy,O=Example KK,C=JP', 'RID:1.3.6.1.4.1.55555.9']);
  eq('validity days, inclusive (BR §6.3.2 counting)', E.validityDays(long), { seconds: 365 * 86400, days: 365 });
  check('BR SC-081 note for a 365-day TLS certificate issued 2026-04-01', E.checkCertificate(long, NOW).some((c) => c.code === 'brValidity' && c.params.max === 200));
  const utf = decodeOne(fx.certs.utf8);
  eq('UTF-8 subject, multi-valued RDN', E.nameToString(utf.subject), 'emailAddress=ops@example.com,CN=测试.example,UID=dev01+OU=研发,O=零工具测试,C=CN');
  eq('IDN SAN shown as Unicode', utf.ext['2.5.29.17'].decoded.names.map((g) => g.unicode), ['测试.example', '例え.jp', '한국.example', '*.한국.example']);
  const inter = decodeOne(fx.certs.inter);
  eq('name constraints', inter.ext['2.5.29.30'].decoded, { permitted: [{ type: 'DNS', value: 'example.com', unicode: null }, { type: 'IP', value: '192.0.2.0/24' }], excluded: [{ type: 'DNS', value: 'internal.example.com', unicode: null }] });
  eq('certificate policies with CPS and user notice', inter.ext['2.5.29.32'].decoded.policies, [
    { oid: '2.23.140.1.2.1', name: 'DV', qualifiers: [] },
    { oid: '1.3.6.1.4.1.55555.1.1', name: null, qualifiers: [{ type: 'CPS', value: 'https://pki.example.com/cps' }, { type: 'userNotice', value: 'ZeroTool test policy' }] }]);
  const leaf = decodeOne(fx.certs.leaf);
  eq('TLS feature (must-staple)', leaf.ext['1.3.6.1.5.5.7.1.24'].decoded.features, [5]);
  eq('AIA', leaf.ext['1.3.6.1.5.5.7.1.1'].decoded.access.map((a) => a.method + ' ' + a.location.value), ['caIssuers http://pki.example.com/int.crt', 'OCSP http://ocsp.example.com']);
  eq('CRL DP', leaf.ext['2.5.29.31'].decoded.points[0].names.map((g) => g.value), ['http://pki.example.com/int.crl']);
  const old = decodeOne(fx.certs.old);
  eq('old certificate checks', E.checkCertificate(old, NOW).map((c) => c.code), ['expired', 'weakHash', 'weakRsa', 'unknownCritical', 'cnOnly']);
  eq('UTCTime 1915→2015 / 2019 years (RFC 5280 §4.1.2.5.1)', [new Date(old.notBefore.ms).getUTCFullYear(), new Date(old.notAfter.ms).getUTCFullYear()], [2015, 2019]);
  const rootC = decodeOne(fx.certs.root);
  eq('GeneralizedTime for 2075', [rootC.notAfter.type, new Date(rootC.notAfter.ms).toISOString(), rootC.notAfter.issues], ['GeneralizedTime', '2075-01-01T00:00:00.000Z', []]);
  // Fingerprints via Web Crypto equal node:crypto
  for (const [name, pem] of Object.entries(fx.certs)) {
    const c = decodeOne(pem);
    const fp = await E.fingerprints(c, subtle);
    eq(name + ' sha256 via Web Crypto', fp.sha256, createHash('sha256').update(c.der).digest('hex').toUpperCase().match(/../g).join(':'));
    eq(name + ' SPKI pin', fp.spkiSha256, createHash('sha256').update(c.spki.raw).digest('base64'));
  }
}

// ── 3. Chains ──
{
  for (const [host, pem] of Object.entries(fx.chains)) {
    const certs = decodeAll(pem);
    const ch = await E.analyzeChain(certs, subtle);
    check(host + ' chain in order', ch.inOrder, JSON.stringify(ch.path));
    for (let i = 0; i + 1 < certs.length; i++) {
      const link = ch.info[i].issuerLink;
      eq(host + ' link #' + (i + 1) + ' signature', link && link.signature.state, 'ok');
      if (opensslVersion) check(host + ' link #' + (i + 1) + ' openssl verify agrees', verifyWithOpenssl(host, certs[i], certs[i + 1]));
    }
  }
  eq('kakao chain ends with its root', (await E.analyzeChain(decodeAll(fx.chains['www.kakao.com']), subtle)).rootIncluded, true);
  const kisa = await E.analyzeChain(decodeAll(fx.chains['www.kisa.or.kr']), subtle);
  eq('kisa.or.kr sends only the leaf', [kisa.path, kisa.rootIncluded, kisa.info[0].issuerLink], [[0], false, null]);

  const leaf = decodeOne(fx.certs.leaf), inter = decodeOne(fx.certs.inter), rootC = decodeOne(fx.certs.root);
  const wrong = await E.analyzeChain([leaf, rootC, inter], subtle);
  eq('wrong order detected, path from leaf', [wrong.inOrder, wrong.path], [false, [0, 2, 1]]);
  const withDup = await E.analyzeChain([leaf, inter, inter, rootC], subtle);
  eq('duplicate certificate', [withDup.info[2].duplicateOf, withDup.inOrder, withDup.path], [1, false, [0, 1, 3]]);
  const p521 = decodeOne(fx.certs.p521);
  const mixed = await E.analyzeChain([leaf, inter, rootC, p521], subtle);
  eq('unrelated certificate', [mixed.unrelated, mixed.inOrder], [[3], false]);
  const bundle = await E.analyzeChain([rootC, decodeOne(fx.certs.ed25519), decodeOne(fx.certs.pss)], subtle);
  eq('self-signed bundle', [bundle.bundle, bundle.info.map((x) => x.selfSigned)], [true, [true, true, true]]);
  eq('RSA-PSS self-signature verifies', (await E.verifySignature(decodeOne(fx.certs.pss), decodeOne(fx.certs.pss), subtle)).state, 'ok');
  eq('Ed25519 self-signature verifies', (await E.verifySignature(decodeOne(fx.certs.ed25519), decodeOne(fx.certs.ed25519), subtle)).state, 'ok');
  eq('P-521 self-signature verifies', (await E.verifySignature(p521, p521, subtle)).state, 'ok');
  eq('ML-DSA reported as unsupported', (await E.verifySignature(decodeOne(fx.certs.mldsa65), decodeOne(fx.certs.mldsa65), subtle)).state, 'unsupported');
  eq('wrong issuer key type', (await E.verifySignature(leaf, rootC, subtle)).state, 'mismatch');
  const tamperedDer = leaf.der.slice();
  tamperedDer[tamperedDer.length - 5] ^= 0x01;
  const tampered = E.decodeCertificate(tamperedDer);
  eq('tampered signature fails', (await E.verifySignature(tampered, inter, subtle)).state, 'bad');
  const tch = await E.analyzeChain([tampered, inter, rootC], subtle);
  eq('tampered leaf: not linked, problem reported', [tch.info[0].issuerLink, tch.info[0].badLink && tch.info[0].badLink.index, tch.problems.map((p) => p.code)], [null, 1, ['badSignature']]);
  eq('PKCS #7 PEM gives the three certificates', E.parseInput(fx.pkcs7).certs.length, 3);
}

// ── 4. In-memory certificates for edge cases ──
const D = {
  len(n) { if (n < 0x80) return Buffer.from([n]); const b = []; while (n > 0) { b.unshift(n & 0xff); n = Math.floor(n / 256); } return Buffer.from([0x80 | b.length, ...b]); },
  tlv(tag, body) { body = Buffer.from(body); return Buffer.concat([Buffer.from([tag]), D.len(body.length), body]); },
  seq: (...p) => D.tlv(0x30, Buffer.concat(p)), set: (...p) => D.tlv(0x31, Buffer.concat(p)),
  intRaw: (bytes) => D.tlv(0x02, Buffer.from(bytes)), int: (n) => { let h = BigInt(n).toString(16); if (h.length % 2) h = '0' + h; if (parseInt(h[0], 16) >= 8) h = '00' + h; return D.tlv(0x02, Buffer.from(h, 'hex')); },
  oid(s) { const p = s.split('.').map(BigInt); const out = [Number(p[0] * 40n + p[1])]; for (const v of p.slice(2)) { const b = []; let x = v; do { b.unshift(Number(x & 0x7fn)); x >>= 7n; } while (x > 0n); for (let i = 0; i < b.length - 1; i++) b[i] |= 0x80; out.push(...b); } return D.tlv(0x06, Buffer.from(out)); },
  utf8: (s) => D.tlv(0x0c, Buffer.from(s, 'utf8')), printable: (s) => D.tlv(0x13, Buffer.from(s, 'latin1')), ia5: (s) => D.tlv(0x16, Buffer.from(s, 'latin1')),
  t61: (bytes) => D.tlv(0x14, Buffer.from(bytes)), bmp: (s) => D.tlv(0x1e, Buffer.from(s, 'utf16le').swap16()),
  univ: (s) => { const cps = [...s].map((c) => c.codePointAt(0)); const b = Buffer.alloc(cps.length * 4); cps.forEach((c, i) => b.writeUInt32BE(c, i * 4)); return D.tlv(0x1c, b); },
  utc: (s) => D.tlv(0x17, Buffer.from(s)), gen: (s) => D.tlv(0x18, Buffer.from(s)),
  octet: (b) => D.tlv(0x04, b), bit: (b, unused = 0) => D.tlv(0x03, Buffer.concat([Buffer.from([unused]), Buffer.from(b)])),
  null: () => Buffer.from([0x05, 0x00]), bool: (v) => Buffer.from([0x01, 0x01, v ? 0xff : 0x00]),
  ctx: (n, body) => D.tlv(0xa0 | n, body), ctxPrim: (n, body) => D.tlv(0x80 | n, body),
};
const ALG = { ecdsa256: D.seq(D.oid('1.2.840.10045.4.3.2')), ecdsa384: D.seq(D.oid('1.2.840.10045.4.3.3')) };
const nameCN = (cn) => D.seq(D.set(D.seq(D.oid('2.5.4.3'), D.utf8(cn))));
function ext(oid, value, critical) { return D.seq(D.oid(oid), critical ? D.bool(true) : Buffer.alloc(0), D.octet(value)); }
const EXT = {
  ca: (pathLen) => ext('2.5.29.19', D.seq(D.bool(true), pathLen == null ? Buffer.alloc(0) : D.int(pathLen)), true),
  ku: (byte) => ext('2.5.29.15', D.bit([byte], 1), true),
  san: (...names) => ext('2.5.29.17', D.seq(...names)),
};
function newKey() { return generateKeyPairSync('ec', { namedCurve: 'P-256' }); }
function makeCert({ version = 3, serial = [0x01], issuer, subject, nb = D.utc('260101000000Z'), na = D.utc('270101000000Z'), key, signer, exts = [], inner = ALG.ecdsa256, outer = ALG.ecdsa256, trailing }) {
  const spki = key.publicKey.export({ type: 'spki', format: 'der' });
  const tbs = D.seq(version === 1 ? Buffer.alloc(0) : D.ctx(0, D.int(version - 1)), D.intRaw(serial), inner, issuer, D.seq(nb, na), subject, spki,
    exts.length ? D.ctx(3, D.seq(...exts)) : Buffer.alloc(0));
  const sig = nodeSign('sha256', tbs, { key: (signer || key).privateKey, dsaEncoding: 'der' });
  const der = D.seq(tbs, outer, D.bit(sig));
  return new Uint8Array(trailing ? Buffer.concat([der, Buffer.from(trailing)]) : der);
}
{
  const k = newKey();
  const self = (opts) => E.decodeCertificate(makeCert({ issuer: nameCN('t'), subject: nameCN('t'), key: k, ...opts }));
  const codes = (c) => E.checkCertificate(c, NOW).map((x) => x.code).filter((x) => x !== 'cnOnly'); // CN-only test certificates; cnOnly is covered by fixture `old`
  const v1 = self({ version: 1 });
  eq('v1 certificate', [v1.version, v1.extensions.length, codes(v1)], [1, 0, []]);
  eq('v1 with extensions', codes(self({ version: 1, exts: [EXT.ca(0)] })), ['extNotV3']);
  const t = self({ nb: D.utc('2601011200+0800'), na: D.gen('20300101000000.5Z') });
  eq('UTCTime without seconds and with an offset', [new Date(t.notBefore.ms).toISOString(), t.notBefore.issues], ['2026-01-01T04:00:00.000Z', ['noSeconds', 'offset']]);
  eq('GeneralizedTime before 2050 with fraction', [new Date(t.notAfter.ms).toISOString(), t.notAfter.issues], ['2030-01-01T00:00:00.500Z', ['fraction', 'generalizedBefore2050']]);
  eq('time checks reported', codes(t).filter((c) => c.startsWith('time_')), ['time_noSeconds', 'time_offset', 'time_fraction', 'time_generalizedBefore2050']);
  eq('UTCTime 49 → 2049, 50 → 1950', [new Date(self({ nb: D.utc('500101000000Z'), na: D.utc('491231235959Z') }).notAfter.ms).getUTCFullYear(), new Date(self({ nb: D.utc('500101000000Z') }).notBefore.ms).getUTCFullYear()], [2049, 1950]);
  eq('no well-defined expiry', self({ na: D.gen('99991231235959Z') }).notAfter.noExpiry, true);
  throwsCode('invalid month', () => self({ nb: D.utc('261301000000Z') }), 'timeFormat', { field: 'notBefore' });
  throwsCode('February 30', () => self({ na: D.gen('20270230000000Z') }), 'timeFormat', { field: 'notAfter' });
  eq('serial zero', codes(self({ serial: [0x00] })), ['serialZero']);
  const long = self({ serial: [0x01, ...randomBytes(20)] });
  eq('21-octet serial', [long.serial.octets, codes(long)], [21, ['serialLong']]);
  eq('signature algorithm mismatch', codes(self({ outer: ALG.ecdsa384 })), ['sigAlgMismatch']);
  eq('duplicate extension', codes(self({ exts: [EXT.ca(0), EXT.ca(1)] })), ['dupExtension']);
  eq('unknown critical extension', codes(self({ exts: [ext('1.2.3.4', D.null(), true)] })), ['unknownCritical']);
  eq('unknown non-critical extension is fine', codes(self({ exts: [ext('1.2.3.4', D.null(), false)] })), []);
  const tr = self({ trailing: [0, 0, 0] });
  eq('trailing bytes after the certificate', [tr.trailing, codes(tr)], [3, ['trailingBytes']]);
  const strs = E.decodeCertificate(makeCert({ issuer: nameCN('t'), key: k,
    subject: D.seq(D.set(D.seq(D.oid('2.5.4.10'), D.bmp('日本語 Ω'))), D.set(D.seq(D.oid('2.5.4.11'), D.univ('😀 x'))),
      D.set(D.seq(D.oid('2.5.4.7'), D.t61([0x4d, 0xfc, 0x6e]))), D.set(D.seq(D.oid('2.5.4.6'), D.printable('JP'))),
      D.set(D.seq(D.oid('2.5.4.3'), D.tlv(0x0c, Buffer.from([0x61, 0xff])))), D.set(D.seq(D.oid('2.5.4.5'), D.ctxPrim(0, [1, 2])))) }));
  eq('BMPString, UniversalString, TeletexString, PrintableString', strs.subject.rdns.slice(0, 4).map((r) => r[0].value), ['日本語 Ω', '😀 x', 'Mün', 'JP']);
  eq('invalid UTF-8 flagged', [strs.subject.rdns[4][0].bad, strs.subject.rdns[4][0].value], [true, 'a\ufffd']);
  eq('non-string value printed as #hex (RFC 4514 §2.4)', E.nameToString(strs.subject).split(',')[0], 'serialNumber=#80020102');
  eq('RFC 4514 escaping', E.nameToString(E.decodeCertificate(makeCert({ issuer: nameCN('t'), key: k, subject: nameCN(' a,b+c"d\\e<f>g;h ') })).subject), 'CN=\\ a\\,b\\+c\\"d\\\\e\\<f\\>g\\;h\\ ');
  eq('RFC 4514 leading #', E.nameToString(E.decodeCertificate(makeCert({ issuer: nameCN('t'), key: k, subject: nameCN('#1') })).subject), 'CN=\\#1');

  // CA checks in a path: root (pathlen 0) → ca1 → ca2 → leaf, and non-CA issuers
  const kr = newKey(), k1 = newKey(), k2 = newKey(), kl = newKey();
  const root = makeCert({ issuer: nameCN('Root'), subject: nameCN('Root'), key: kr, exts: [EXT.ca(0), EXT.ku(0x06)] });
  const ca1 = makeCert({ issuer: nameCN('Root'), subject: nameCN('CA1'), key: k1, signer: kr, exts: [EXT.ca(), EXT.ku(0x06)] });
  const ca2 = makeCert({ issuer: nameCN('CA1'), subject: nameCN('CA2'), key: k2, signer: k1, exts: [EXT.ca(), EXT.ku(0x80)] });
  const leaf = makeCert({ issuer: nameCN('CA2'), subject: nameCN('leaf'), key: kl, signer: k2, exts: [EXT.san(D.ctxPrim(2, Buffer.from('leaf.example')))] });
  const path = await E.analyzeChain([leaf, ca2, ca1, root].map((d) => E.decodeCertificate(d)), subtle);
  eq('built chain verifies and is in order', [path.inOrder, path.info.slice(0, 3).map((x) => x.issuerLink.signature.state)], [true, ['ok', 'ok', 'ok']]);
  eq('path length and keyCertSign problems', path.problems.map((p) => p.code + '#' + p.params.index), ['issuerNoCertSign#2', 'pathLen#4']);
  const notCa = makeCert({ issuer: nameCN('Root'), subject: nameCN('CA1'), key: k1, signer: kr, exts: [EXT.ku(0x06)] });
  const leaf2 = makeCert({ issuer: nameCN('CA1'), subject: nameCN('leaf'), key: kl, signer: k1 });
  eq('issuer without CA flag', (await E.analyzeChain([leaf2, notCa].map((d) => E.decodeCertificate(d)), subtle)).problems.map((p) => p.code), ['issuerNotCa']);
  const caseName = makeCert({ issuer: D.seq(D.set(D.seq(D.oid('2.5.4.3'), D.printable('  ca1 ')))), subject: nameCN('leaf'), key: kl, signer: k1 });
  const norm = await E.analyzeChain([caseName, ca1].map((d) => E.decodeCertificate(d)), subtle);
  eq('issuer name matched after RFC 5280 §7.1 normalization', [norm.info[0].issuerLink.name, norm.info[0].issuerLink.signature.state], ['normalized', 'ok']);

  // Hostnames (RFC 9525)
  const hostCert = E.decodeCertificate(makeCert({ issuer: nameCN('t'), subject: nameCN('cn-only.example'), key: k, exts: [EXT.san(
    D.ctxPrim(2, Buffer.from('*.example.com')), D.ctxPrim(2, Buffer.from('exact.example.org')), D.ctxPrim(2, Buffer.from('xn--0zwm56d.example')),
    D.ctxPrim(2, Buffer.from('f*.example.net')), D.ctxPrim(7, Buffer.from([192, 0, 2, 1])), D.ctxPrim(7, Buffer.from('20010db8000000000000000000000001', 'hex')))] }));
  const hm = (h) => { const r = E.matchHostname(hostCert, h); return r.state + (r.by ? ':' + r.by.value : ''); };
  eq('wildcard covers one label', [hm('www.example.com'), hm('example.com'), hm('a.b.example.com')], ['match:*.example.com', 'nomatch', 'nomatch']);
  eq('exact, case, trailing dot, URL', [hm('EXACT.example.org.'), hm('https://exact.example.org:8443/x?y')], ['match:exact.example.org', 'match:exact.example.org']);
  eq('IDN input', [hm('测试.example'), hm('ＥＸＡＣＴ.example.org')], ['match:xn--0zwm56d.example', 'match:exact.example.org']);
  eq('partial-label wildcard is not honoured', hm('foo.example.net'), 'nomatch');
  eq('IP addresses', [hm('192.0.2.1'), hm('[2001:db8::1]'), hm('2001:DB8:0:0::1'), hm('192.0.2.2')], ['match:192.0.2.1', 'match:2001:db8::1', 'match:2001:db8::1', 'nomatch']);
  eq('CN is not used when SAN exists', hm('cn-only.example'), 'cnOnly');
  eq('invalid host', [hm(''), hm('a b'), hm('999.1.1.1')], ['invalid', 'invalid', 'invalid']);
  eq('fixture leaf: IDN SAN', [E.matchHostname(decodeOne(fx.certs.leaf), '测试.example.com').by.value, E.matchHostname(decodeOne(fx.certs.leaf), 'a.b.example.com').state], ['xn--0zwm56d.example.com', 'nomatch']);
  eq('fixture leaf: IP SAN', E.matchHostname(decodeOne(fx.certs.leaf), '192.0.2.10').state, 'match');
  eq('example.com chain: www via wildcard', E.matchHostname(decodeAll(fx.chains['www.example.com'])[0], 'www.example.com').wildcard, true);
  eq('kakao chain: www.kakao.com', E.matchHostname(decodeAll(fx.chains['www.kakao.com'])[0], 'www.kakao.com').state, 'match');
  eq('CN-only old certificate', E.matchHostname(decodeOne(fx.certs.old), 'old.example.net').state, 'cnOnly');
}

// ── 5. Input formats and error positions ──
{
  const leafPem = fx.certs.leaf;
  const der = new Uint8Array(pemBody(leafPem));
  const same = (name, input) => { const p = E.parseInput(input); eq(name, p.certs.map((c) => Buffer.from(c.der).toString('hex')), [Buffer.from(der).toString('hex')]); };
  same('CRLF line endings', leafPem.replace(/\n/g, '\r\n'));
  same('extra spaces and tabs', leafPem.replace(/\n/g, '  \t\n   '));
  same('text around the block (s_client output)', 'depth=0 CN = www.example.com\nverify return:1\n' + leafPem + '---\nServer certificate\n');
  same('headerless Base64', pemBody(leafPem).toString('base64'));
  same('headerless Base64 without padding', pemBody(leafPem).toString('base64').replace(/=+$/, ''));
  same('DER bytes', der);
  same('PEM bytes', new Uint8Array(Buffer.from(leafPem)));
  same('legacy X509 CERTIFICATE label', leafPem.replace(/CERTIFICATE/g, 'X509 CERTIFICATE'));
  same('byte order mark', '\uFEFF' + leafPem);
  const trusted = E.parseInput(leafPem.replace(/CERTIFICATE/g, 'TRUSTED CERTIFICATE'));
  eq('TRUSTED CERTIFICATE', [trusted.certs.length, trusted.notices[0].code], [1, 'trusted']);
  const p7der = new Uint8Array(pemBody(fx.pkcs7));
  eq('PKCS #7 DER', E.parseInput(p7der).certs.length, 3);
  eq('classify PKCS #7', E.classifyDer(p7der).kind, 'pkcs7');

  // Private keys: generated for this run, never stored.
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pk8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const sec1 = privateKey.export({ type: 'sec1', format: 'pem' });
  const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey;
  const pk1 = rsa.export({ type: 'pkcs1', format: 'pem' });
  const enc = rsa.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-128-cbc', passphrase: 'x' });
  const combo = E.parseInput(leafPem + pk8 + sec1 + pk1 + enc);
  eq('private key blocks skipped, certificate kept', [combo.certs.length, combo.hasPrivateKey, combo.notices.map((n) => n.code + ':' + n.params.label)],
    [1, true, ['privateKey:PRIVATE KEY', 'privateKey:EC PRIVATE KEY', 'privateKey:RSA PRIVATE KEY', 'privateKey:ENCRYPTED PRIVATE KEY']]);
  const keyOnly = E.parseInput(pk8);
  eq('private key only', [keyOnly.certs.length, keyOnly.hasPrivateKey], [0, true]);
  for (const [name, d] of [['PKCS #8 DER', privateKey.export({ type: 'pkcs8', format: 'der' })], ['SEC 1 DER', privateKey.export({ type: 'sec1', format: 'der' })],
    ['PKCS #1 DER', rsa.export({ type: 'pkcs1', format: 'der' })], ['encrypted PKCS #8 DER', rsa.export({ type: 'pkcs8', format: 'der', cipher: 'aes-128-cbc', passphrase: 'x' })]]) {
    const r = E.parseInput(new Uint8Array(d));
    eq(name + ' is refused', [r.certs.length, r.hasPrivateKey, r.notices[0].code], [0, true, 'privateKeyDer']);
  }
  const pfx = new Uint8Array(D.seq(D.int(3), D.seq(D.oid('1.2.840.113549.1.7.1'), D.ctx(0, D.octet(Buffer.from([0x30, 0x00])))), D.seq()));
  eq('PKCS #12 is refused', [E.classifyDer(pfx).kind, E.parseInput(pfx).hasPrivateKey], ['pkcs12', true]);
  const spkiDer = new Uint8Array(privateKey.export({ type: 'pkcs8', format: 'der' }).length ? generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' }) : []);
  eq('bare public key', E.parseInput(spkiDer).notices[0].code, 'notCert_publicKey');
  const csrDer = D.seq(D.seq(D.int(0), nameCN('x'), Buffer.from(spkiDer), D.ctx(0, Buffer.alloc(0))), ALG.ecdsa256, D.bit([1, 2, 3]));
  eq('CSR DER', E.classifyDer(new Uint8Array(csrDer)).kind, 'csr');
  eq('CSR PEM label', E.parseInput(E.toPem(new Uint8Array(csrDer), 'CERTIFICATE REQUEST')).notices[0].code, 'notCert_csr');
  eq('unknown PEM label', E.parseInput('-----BEGIN FOO-----\nAAAA\n-----END FOO-----\n').notices[0].code, 'unknownLabel');

  const lines = leafPem.split('\n');
  const badChar = lines.slice(); badChar[3] = badChar[3].slice(0, 4) + '*' + badChar[3].slice(5);
  throwsCode('invalid Base64 character', () => E.parseInput(badChar.join('\n')), 'b64Char', { line: 4, col: 5, ch: '*' });
  const body = pemBody(leafPem).toString('base64').replace(/=+$/, '');
  const cutTo = body.length - ((body.length - 1) % 4);
  throwsCode('Base64 length that cannot be decoded', () => E.parseInput('-----BEGIN CERTIFICATE-----\n' + body.slice(0, cutTo) + '\n-----END CERTIFICATE-----\n'), 'b64Length', { line: 1, n: cutTo });
  const missingLine = lines.filter((_, i) => i !== 5).join('\n');
  throwsCode('a missing line truncates the DER', () => E.decodeCertificate(E.parseInput(missingLine).certs[0].der), 'asnOverrun', { offset: 0, field: 'Certificate' });
  throwsCode('missing END line', () => E.parseInput('text\n' + lines.slice(0, -2).join('\n')), 'pemNoEnd', { line: 2, label: 'CERTIFICATE' });
  throwsCode('END without BEGIN', () => E.parseInput(lines.slice(1).join('\n')), 'pemNoBegin');
  throwsCode('empty input', () => E.parseInput('  \n '), 'empty');
  throwsCode('plain text', () => E.parseInput('hello world'), 'noCert');
  throwsCode('text with punctuation', () => E.parseInput('not a cert!'), 'b64Char', { line: 1, col: 11, ch: '!' });
  throwsCode('padding then data', () => E.parseInput('-----BEGIN CERTIFICATE-----\nMII=A\n-----END CERTIFICATE-----'), 'b64AfterPad', { line: 2, col: 5 });
  const cut = der.slice(0, der.length - 10);
  throwsCode('truncated DER', () => E.decodeCertificate(cut), 'asnOverrun', { offset: 0, field: 'Certificate', need: der.length, have: der.length - 10 });
  throwsCode('not a SEQUENCE', () => E.decodeCertificate(new Uint8Array([0x04, 0x01, 0x00])), 'asnTag', { offset: 0, expected: 'SEQUENCE', got: 'OCTET STRING' });
  throwsCode('indefinite length (BER)', () => E.decodeCertificate(new Uint8Array([0x30, 0x80, 0x00, 0x00])), 'asnIndefinite');
  const badInner = der.slice(); badInner[4] = 0x31;
  throwsCode('tbsCertificate tag damaged', () => E.decodeCertificate(badInner), 'asnTag', { offset: 4, field: 'tbsCertificate' });
}

// ── 6. Helpers against independent references ──
{
  for (let i = 0; i < 2000; i++) {
    const b = Buffer.alloc(16);
    for (let j = 0; j < 8; j++) if (Math.random() < 0.5) b.writeUInt16BE(Math.floor(Math.random() * 65536), j * 2);
    const want = new URL('http://[' + b.toString('hex').match(/..../g).join(':') + ']/').hostname.slice(1, -1);
    const got = E.formatIp(new Uint8Array(b));
    if (got !== want) { check('IPv6 RFC 5952 vs WHATWG URL', false, got + ' vs ' + want); break; }
    if (i === 1999) check('IPv6 RFC 5952 vs WHATWG URL (2000 addresses)', true);
  }
  for (const label of ['xn--0zwm56d', 'xn--r8jz45g', 'xn--3e0b707e', 'xn--fiqs8s', 'xn--mgbh0fb', 'xn--d1acpjx3f', 'xn--bcher-kva', 'xn--ls8h', 'xn--90ae', 'xn--wgv71a119e']) {
    eq('punycode ' + label, E.punycodeDecode(label.slice(4)), domainToUnicode(label));
  }
  eq('punycode garbage', E.punycodeDecode('!!'), null);
  let md5ok = true;
  for (let n = 0; n < 300; n++) {
    const b = randomBytes(n);
    if (E.bytesToHex(E.md5(new Uint8Array(b)), '').toLowerCase() !== createHash('md5').update(b).digest('hex')) { md5ok = false; break; }
  }
  check('MD5 vs node:crypto (0–299 bytes)', md5ok);
  eq('BR maximum by issue date', [Date.UTC(2026, 2, 14), Date.UTC(2026, 2, 15), Date.UTC(2027, 2, 15), Date.UTC(2029, 2, 15)].map(E.brMaxDays), [398, 200, 100, 47]);
}

// ── 7. Strings, examples, static guarantees ──
{
  const langs = ['en', 'zh', 'ja', 'ko'];
  const keys = Object.keys(STRINGS.en).sort();
  for (const l of langs) eq('STRINGS ' + l + ' keys', Object.keys(STRINGS[l]).sort(), keys);
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const k of keys) for (const l of langs) if (ph(STRINGS[l][k]) !== ph(STRINGS.en[k])) check('placeholders ' + l + '.' + k, false, STRINGS[l][k]);
  const codes = [...block.matchAll(/ScdError\('(\w+)'/g)].map((m) => 'err' + m[1][0].toUpperCase() + m[1].slice(1));
  for (const c of new Set(codes)) check('error string ' + c, c in STRINGS.en);
  const checksUsed = [...block.matchAll(/add\('(?:error|warn|info)', '(\w+)'/g)].map((m) => 'chk_' + m[1]);
  for (const c of new Set(checksUsed.filter((x) => !x.endsWith('_')))) check('check string ' + c, c in STRINGS.en);
  for (const iss of ['noSeconds', 'fraction', 'noZone', 'offset', 'generalizedBefore2050']) check('time string ' + iss, ('chk_time_' + iss) in STRINGS.en);
  const notes = [...block.matchAll(/code: '(\w+)'/g)].map((m) => m[1]).concat(['notCert_csr', 'notCert_publicKey', 'notCert_crl', 'notCert_pkcs12']);
  for (const n of new Set(notes.filter((x) => !x.endsWith('_')))) {
    const k = 'note' + n[0].toUpperCase() + n.slice(1), p = 'prob' + n[0].toUpperCase() + n.slice(1);
    check('notice / problem string ' + n, k in STRINGS.en || p in STRINGS.en);
  }
  const hostMap = { en: 'www.example.com', zh: 'www.baidu.com', ja: 'www.digital.go.jp', ko: 'www.kakao.com' };
  for (const l of langs) eq('example ' + l + ' equals the fixture chain', [EXAMPLES[l].host, EXAMPLES[l].date, EXAMPLES[l].pem], [hostMap[l], fx.chainsFetched, fx.chains[hostMap[l]]]);
  const script = source.slice(source.indexOf('<script'), source.indexOf('</script>'));
  check('no network calls in the component', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|importScripts/.test(script));
  check('input with a private key is not persisted', /if \(hasKey \|\| \/PRIVATE KEY-----\/\.test\(inputEl\.value\)\) window\.ztPersist\.clear\(SLUG\)/.test(script));
  check('file text drops private key blocks', /PRIVATE KEY\)-----\[\\s\\S\]\*\?-----END \\1-----/.test(script));
  const fixtureText = readFileSync(join(root, 'scripts/test-ssl-certificate-decoder.fixtures.json'), 'utf8');
  check('fixture holds no private key', !/PRIVATE KEY/.test(fixtureText));
  check('fixture holds no cloud key formats', !/AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|LTAI[0-9A-Za-z]{12,}|-----BEGIN OPENSSH/.test(fixtureText));
}

// ── 8. Values quoted on the tool pages ──
{
  const pages = Object.fromEntries(['en', 'zh', 'ja', 'ko'].map((l) => [l, readFileSync(join(root, 'src/content/tools/ssl-certificate-decoder/' + l + '.mdx'), 'utf8')]));
  for (const [l, text] of Object.entries(pages)) {
    for (const m of text.matchAll(/\{\/\* scd-check: (\{.*?\}) \*\/\}/g)) {
      const spec = JSON.parse(m[1]);
      const certs = decodeAll(spec.chain ? fx.chains[spec.chain] : fx.certs[spec.cert]);
      const c = certs[spec.index || 0];
      let got;
      if (spec.field === 'days') got = String(E.validityDays(c).days);
      else if (spec.field === 'sha256') got = (await E.fingerprints(c, subtle)).sha256;
      else if (spec.field === 'spki') got = (await E.fingerprints(c, subtle)).spkiSha256;
      else if (spec.field === 'notAfter') got = new Date(c.notAfter.ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      else if (spec.field === 'notBefore') got = new Date(c.notBefore.ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      else if (spec.field === 'count') got = String(certs.length);
      else if (spec.field === 'sct') got = String(c.ext['1.3.6.1.4.1.11129.2.4.2'].decoded.scts.length);
      else if (spec.field === 'subject') got = E.nameToString(c.subject);
      else if (spec.field === 'issuer') got = E.nameToString(c.issuer);
      else if (spec.field === 'host') got = E.matchHostname(c, spec.host).state;
      else if (spec.field === 'sanCount') got = String(c.ext['2.5.29.17'].decoded.names.length);
      else if (spec.field === 'caIssuers') got = c.ext['1.3.6.1.5.5.7.1.1'].decoded.access.filter((a) => a.method === 'caIssuers').map((a) => a.location.value).join(' ');
      else if (spec.field === 'cutNeed' || spec.field === 'cutHave') {
        // The first certificate with its second-to-last Base64 line removed, as when one line is lost while copying.
        const lines = fx.chains[spec.chain].match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\n/)[0].split('\n');
        try { E.decodeCertificate(E.parseInput(lines.filter((_, i) => i !== lines.length - 4).join('\n')).certs[0].der); got = 'no error'; }
        catch (e) { got = e.code === 'asnOverrun' ? String(spec.field === 'cutNeed' ? e.params.need : e.params.have) : e.code; }
      }
      else if (spec.field === 'reversedPath') {
        const blocks = fx.chains[spec.chain].match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\n/g).reverse();
        const ch = await E.analyzeChain(decodeAll(blocks.join('')), subtle);
        got = ch.inOrder ? 'in order' : ch.path.map((x) => '#' + (x + 1)).join(' → ');
      }
      eq(l + ' page: ' + m[1], got, spec.expect);
      check(l + ' page shows ' + spec.expect, text.indexOf(spec.expect) >= 0 || spec.field === 'host');
    }
  }
}

console.log(`\n${passes} passed, ${failures} failed, ${skips} skipped`);
process.exit(failures ? 1 : 0);
