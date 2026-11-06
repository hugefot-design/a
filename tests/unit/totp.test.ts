/**
 * Kodene fra kode-appen (TOTP) og krypteringen av hemmeligheten.
 * Testvektorene er fra RFC 6238 (SHA-1, 8 sifre).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, currentStep, generateTotpSecret, otpauthUri, totpAt, verifyTotp } from '../../src/lib/totp';
import { decryptSecret, encryptSecret } from '../../src/lib/crypto';

const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('RFC 6238-testvektorer', () => {
  assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  for (const [seconds, expected] of [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ] as const) {
    assert.equal(totpAt(RFC_SECRET, Math.floor(seconds / 30), 8), expected, String(seconds));
  }
});

test('base32 begge veier, og nye hemmeligheter er 160 bit', () => {
  const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 9]);
  assert.deepEqual(base32Decode(base32Encode(buf)), buf);
  const s = generateTotpSecret();
  assert.equal(base32Decode(s).length, 20);
  assert.notEqual(generateTotpSecret(), s);
});

test('koden godtas i forrige, nåværende og neste steg – ikke lenger, og ikke to ganger', () => {
  const secret = generateTotpSecret();
  const now = Date.UTC(2026, 10, 6, 12, 0, 15);
  const step = currentStep(now);
  assert.equal(verifyTotp(secret, totpAt(secret, step), { now }), step);
  assert.equal(verifyTotp(secret, totpAt(secret, step - 1), { now }), step - 1);
  assert.equal(verifyTotp(secret, totpAt(secret, step + 1), { now }), step + 1);
  assert.equal(verifyTotp(secret, totpAt(secret, step - 2), { now }), null);
  assert.equal(verifyTotp(secret, totpAt(secret, step), { now, lastStep: step }), null, 'samme kode to ganger');
  assert.equal(verifyTotp(secret, '12345', { now }), null);
  assert.equal(verifyTotp(secret, 'abcdef', { now }), null);
  assert.equal(verifyTotp(secret, ` ${totpAt(secret, step).slice(0, 3)} ${totpAt(secret, step).slice(3)} `, { now }), step, 'mellomrom tåles');
});

test('adressen til QR-koden', () => {
  const uri = otpauthUri('kari@example.com', 'ABCDEFGH');
  assert.match(uri, /^otpauth:\/\/totp\/AnbudRadar%3Akari%40example\.com\?/);
  assert.match(uri, /secret=ABCDEFGH/);
  assert.match(uri, /issuer=AnbudRadar/);
});

test('hemmeligheten lagres kryptert og kan ikke endres i det stille', () => {
  const enc = encryptSecret('JBSWY3DPEHPK3PXP');
  assert.notEqual(enc, encryptSecret('JBSWY3DPEHPK3PXP'), 'ny tilfeldig IV hver gang');
  assert.doesNotMatch(enc, /JBSWY3DPEHPK3PXP/);
  assert.equal(decryptSecret(enc), 'JBSWY3DPEHPK3PXP');
  const parts = enc.split('.');
  const tampered = [parts[0], parts[1], parts[2], (parts[3]![0] === 'A' ? 'B' : 'A') + parts[3]!.slice(1)].join('.');
  assert.throws(() => decryptSecret(tampered));
});
