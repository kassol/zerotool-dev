// Regenerate the fixtures for scripts/test-ssl-certificate-decoder.mjs.
//
// Read:  nothing in the repository; runs `openssl` (3.5 or later for the ML-DSA certificate)
//        and, with --live, `openssl s_client` against 6 public HTTPS sites.
// Write: scripts/test-ssl-certificate-decoder.fixtures.json (certificates only).
//        Private keys are created in a temporary directory under os.tmpdir() and deleted
//        before the script exits; they are never written to the fixture file.
// Exit:  0 on success, 1 if any openssl command fails.
//
// Without --live the public chains already in the fixture file are kept as they are.
//
// Run: node scripts/gen-ssl-certificate-decoder-fixtures.mjs [--live]

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, 'scripts/test-ssl-certificate-decoder.fixtures.json');
const dir = mkdtempSync(join(tmpdir(), 'scd-fixtures-'));
const live = process.argv.includes('--live');

function ossl(args, input) {
  return execFileSync('openssl', args, { cwd: dir, input, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}
function write(name, text) { writeFileSync(join(dir, name), text); return name; }
function read(name) { return readFileSync(join(dir, name), 'utf8'); }

const CNF = `
[req]
distinguished_name = dn
string_mask = utf8only
utf8 = yes
[dn]

[root]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash

[inter]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,digitalSignature,keyCertSign,cRLSign
extendedKeyUsage = serverAuth,clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
nameConstraints = critical,permitted;DNS:example.com,permitted;IP:192.0.2.0/255.255.255.0,excluded;DNS:internal.example.com
authorityInfoAccess = caIssuers;URI:http://pki.example.com/root.crt,OCSP;URI:http://ocsp.example.com
crlDistributionPoints = URI:http://pki.example.com/root.crl
certificatePolicies = 2.23.140.1.2.1,@pol1

[pol1]
policyIdentifier = 1.3.6.1.4.1.55555.1.1
CPS.1 = "https://pki.example.com/cps"
userNotice.1 = @notice

[notice]
explicitText = "ZeroTool test policy"

[leaf]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
subjectAltName = DNS:www.example.com,DNS:*.example.com,DNS:xn--0zwm56d.example.com,IP:192.0.2.10,email:admin@example.com,URI:https://www.example.com/
authorityInfoAccess = caIssuers;URI:http://pki.example.com/int.crt,OCSP;URI:http://ocsp.example.com
crlDistributionPoints = URI:http://pki.example.com/int.crl
certificatePolicies = 2.23.140.1.2.1
tlsfeature = status_request

[long]
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
subjectAltName = DNS:legacy.example.org,IP:198.51.100.7,IP:2001:db8:0:0:1:0:0:1,otherName:1.3.6.1.4.1.311.20.2.3;UTF8:user@example.org,dirName:dir_sect,RID:1.3.6.1.4.1.55555.9

[dir_sect]
C = JP
O = Example KK
CN = legacy

[old]
subjectKeyIdentifier = hash
1.2.3.4 = critical,ASN1:NULL

[selfleaf]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
subjectAltName = DNS:p521.example, IP:2001:db8::1
subjectKeyIdentifier = hash

[idn]
subjectAltName = DNS:xn--0zwm56d.example,DNS:xn--r8jz45g.jp,DNS:xn--3e0b707e.example,DNS:*.xn--3e0b707e.example
subjectKeyIdentifier = hash
`;

write('openssl.cnf', CNF);

function key(name, args) { ossl(['genpkey', ...args, '-out', name + '.key']); return name + '.key'; }
function csr(name, subj, extra = []) {
  ossl(['req', '-new', '-config', 'openssl.cnf', '-key', name + '.key', '-subj', subj, '-out', name + '.csr', ...extra]);
}
function sign(name, { issuer, ext, serial, nb, na, md, sigopt = [] }) {
  const args = ['x509', '-req', '-in', name + '.csr', '-extfile', 'openssl.cnf', '-extensions', ext,
    '-set_serial', serial, '-not_before', nb, '-not_after', na, '-out', name + '.pem'];
  if (issuer) args.push('-CA', issuer + '.pem', '-CAkey', issuer + '.key');
  else args.push('-key', name + '.key');
  if (md) args.push('-' + md);
  for (const o of sigopt) args.push('-sigopt', o);
  ossl(args);
  return read(name + '.pem');
}

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const certs = {};
key('root', ['-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:4096']);
csr('root', '/C=US/O=ZeroTool Test/CN=ZeroTool Test Root R1');
certs.root = sign('root', { ext: 'root', serial: '0x0100', nb: '20250101000000Z', na: '20750101000000Z', md: 'sha256' });

key('inter', ['-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-384']);
csr('inter', '/C=US/O=ZeroTool Test/CN=ZeroTool Test ECC CA 1');
certs.inter = sign('inter', { issuer: 'root', ext: 'inter', serial: '0x7a3c19d2e4f05b6a8c1d2e3f40516273', nb: '20250601000000Z', na: '20350601000000Z', md: 'sha384' });

key('leaf', ['-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256']);
csr('leaf', '/CN=www.example.com');
certs.leaf = sign('leaf', { issuer: 'inter', ext: 'leaf', serial: '0x00e1f2a3b4c5d6e7f8091a2b3c4d5e6f70', nb: '20260901000000Z', na: '20261129235959Z', md: 'sha384' });

key('long', ['-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048']);
csr('long', '/C=JP/O=Example KK/CN=legacy.example.org');
certs.long = sign('long', { issuer: 'root', ext: 'long', serial: '4660', nb: '20260401000000Z', na: '20270331235959Z', md: 'sha256' });

key('old', ['-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:1024']);
csr('old', '/CN=old.example.net');
certs.old = sign('old', { ext: 'old', serial: '1', nb: '150101000000Z', na: '191231235959Z', md: 'sha1' });

key('p521', ['-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-521']);
csr('p521', '/CN=p521.example');
certs.p521 = sign('p521', { ext: 'selfleaf', serial: '0x5210', nb: '20260101000000Z', na: '20280101000000Z', md: 'sha512' });

key('ed', ['-algorithm', 'ED25519']);
csr('ed', '/O=ZeroTool Test/CN=ed25519.example');
certs.ed25519 = sign('ed', { ext: 'root', serial: '0x25519', nb: '20260101000000Z', na: '20360101000000Z' });

key('pss', ['-algorithm', 'RSA-PSS', '-pkeyopt', 'rsa_keygen_bits:2048', '-pkeyopt', 'rsa_pss_keygen_md:sha256', '-pkeyopt', 'rsa_pss_keygen_mgf1_md:sha256', '-pkeyopt', 'rsa_pss_keygen_saltlen:32']);
csr('pss', '/CN=pss.example');
certs.pss = sign('pss', { ext: 'root', serial: '0x0a55', nb: '20260101000000Z', na: '20360101000000Z', md: 'sha256', sigopt: ['rsa_padding_mode:pss', 'rsa_pss_saltlen:32', 'rsa_mgf1_md:sha256'] });

key('neg', ['-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256']);
csr('neg', '/CN=negative-serial.example');
certs.negative = sign('neg', { ext: 'selfleaf', serial: '-12345', nb: '20260101000000Z', na: '20270101000000Z', md: 'sha256' });

key('utf', ['-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256']);
csr('utf', '/C=CN/O=零工具测试/OU=研发+UID=dev01/CN=测试.example/emailAddress=ops@example.com', ['-utf8', '-multivalue-rdn']);
certs.utf8 = sign('utf', { ext: 'idn', serial: '0x0c0de', nb: '20260101000000Z', na: '20270101000000Z', md: 'sha256' });

const version = ossl(['version']).trim();
try {
  key('mldsa', ['-algorithm', 'ML-DSA-65']);
  csr('mldsa', '/CN=ml-dsa.example');
  certs.mldsa65 = sign('mldsa', { ext: 'root', serial: '0x6565', nb: '20260101000000Z', na: '20360101000000Z' });
} catch (e) {
  console.error('ML-DSA not available in ' + version + '; keeping the previous fixture if any');
}

write('bundle.pem', certs.leaf + certs.inter + certs.root);
const pkcs7 = ossl(['crl2pkcs7', '-nocrl', '-certfile', 'bundle.pem']);

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
if (!certs.mldsa65 && previous.certs && previous.certs.mldsa65) certs.mldsa65 = previous.certs.mldsa65;

let chains = previous.chains || {};
let chainsFetched = previous.chainsFetched || null;
if (live) {
  chains = {};
  for (const host of ['www.example.com', 'www.baidu.com', 'www.digital.go.jp', 'www.kakao.com', 'www.kisa.or.kr', 'letsencrypt.org']) {
    const out = execFileSync('openssl', ['s_client', '-connect', host + ':443', '-servername', host, '-showcerts'],
      { input: '', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 }).toString();
    const blocks = out.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\n?/g) || [];
    if (!blocks.length) throw new Error('no certificates from ' + host);
    chains[host] = blocks.map((b) => b.trim() + '\n').join('');
  }
  chainsFetched = new Date().toISOString().slice(0, 10);
}

const data = {
  note: 'Generated by scripts/gen-ssl-certificate-decoder-fixtures.mjs. Certificates only; the private keys were deleted after signing.',
  generatedWith: version,
  certs,
  pkcs7,
  chains,
  chainsFetched,
};
for (const v of Object.values(certs)) if (/PRIVATE KEY/.test(v)) throw new Error('private key material in fixture');
writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
rmSync(dir, { recursive: true, force: true });
console.log('wrote ' + OUT + ' (' + Object.keys(certs).length + ' certificates, ' + Object.keys(chains).length + ' public chains)');
