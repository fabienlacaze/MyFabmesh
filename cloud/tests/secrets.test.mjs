// Tests de la garde build/check-secrets.mjs (constat DEP-11, 2026-10-03).
// Les faux secrets sont construits par morceaux : ce fichier ne declenche pas la garde.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GARDE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'build', 'check-secrets.mjs');
const alea = (n) => 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ2cF4hJ6lM8oR0uX'.slice(0, n);
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function lancer(contenu, nom = 'x.txt') {
  const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
  try {
    const f = join(dir, nom);
    if (contenu !== null) writeFileSync(f, contenu);
    return spawnSync(process.execPath, [GARDE, '--files', f], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const faux = {
  stripe: 'sk_' + 'live_' + alea(30),
  webhook: 'whsec' + '_' + alea(30),
  aws: 'AK' + 'IA' + 'ABCDEFGH12345678',
  hf: 'hf' + '_' + alea(34),
  replicate: 'r8' + '_' + alea(34),
  pem: '-----BEGIN RSA PRIVATE ' + 'KEY-----',
  mfm: 'mfm' + '_' + alea(40),
  jwt: 'eyJ' + b64u({ alg: 'HS256' }).slice(3) + '.' + b64u({ iss: 'supabase', role: 'service_' + 'role', ref: 'abcdefghijklmnopqrstuvwxyz' }) + '.' + alea(43),
};

for (const [nom, valeur] of Object.entries(faux)) {
  test('refuse ' + nom, () => {
    const r = lancer('ligne\nvaleur = "' + valeur + '"\n');
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /:2/);
  });
}

test('accepte un JWT anon (role anon)', () => {
  const jwt = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ iss: 'supabase', role: 'anon', ref: 'abcdefghijklmnopqrstuvwxyz' }) + '.' + alea(43);
  assert.equal(lancer('cle ' + jwt).status, 0);
});

test('accepte un gabarit de documentation', () => {
  assert.equal(lancer("TOKEN = 'hf" + "_" + "x".repeat(34) + "'").status, 0);
});

test('accepte un texte sans secret', () => {
  assert.equal(lancer('rien a voir ici\n').status, 0);
});

test('ignore un binaire', () => {
  assert.equal(lancer(Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(faux.stripe)]), 'b.bin').status, 0);
});

test('echoue (ferme) si le fichier est illisible', () => {
  const r = lancer(null, 'absent.txt');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /lecture impossible/);
});
