/**
 * Varsel ved admin-innlogging: bare fra ny enhet eller ny IP-adresse (IPv6: samme /64-nett regnes som samme
 * adresse), men alltid ved reservekode og uten totrinn. Selve flyten testes i tests/integration/admin-stepup.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginNoticeReason, networkKey, validDeviceId } from '../../src/domain/auth/security';

test('IPv4 er hele adressen; IPv6 regnes per /64-nett', () => {
  assert.equal(networkKey('84.208.10.20'), '84.208.10.20');
  assert.notEqual(networkKey('84.208.10.20'), networkKey('84.208.10.21'));
  assert.equal(networkKey('::ffff:84.208.10.20'), '84.208.10.20', 'IPv4 skrevet som IPv6');
  // Personvernadresser i samme hjemmenett: samme nett.
  assert.equal(networkKey('2a01:79c:cebd:1234:a1b2:c3d4:e5f6:789'), '2a01:79c:cebd:1234::/64');
  assert.equal(networkKey('2a01:79c:cebd:1234::1'), '2a01:79c:cebd:1234::/64');
  assert.equal(networkKey('2A01:079C:CEBD:1234:FFFF::'), '2a01:79c:cebd:1234::/64', 'store bokstaver og ledende nuller');
  assert.equal(networkKey('fe80::1%eth0'), 'fe80:0:0:0::/64', 'sone-ID fjernes');
  // Et annet nett er en ny adresse.
  assert.notEqual(networkKey('2a01:79c:cebd:1235::1'), networkKey('2a01:79c:cebd:1234::1'));
  assert.equal(networkKey('::1'), '0:0:0:0::/64');
  assert.equal(networkKey('unknown'), 'unknown');
});

test('e-post bare når enheten eller IP-adressen er ny – alltid ved reservekode og uten totrinn', () => {
  const known = { device: true, network: true };
  assert.equal(loginNoticeReason('totp', known), null);
  assert.equal(loginNoticeReason('passkey', known), null);
  assert.equal(loginNoticeReason('totp', { device: false, network: true }), 'new_device');
  assert.equal(loginNoticeReason('passkey', { device: true, network: false }), 'new_network');
  assert.equal(loginNoticeReason('totp', { device: false, network: false }), 'new_device_and_network');
  assert.equal(loginNoticeReason('recovery', known), 'recovery_code');
  assert.equal(loginNoticeReason('password_only', known), 'no_mfa');
});

test('enhetsnøkkelen må se ut som en tilfeldig nøkkel', () => {
  assert.equal(validDeviceId('a'.repeat(43)), 'a'.repeat(43));
  assert.equal(validDeviceId('Ab_-'.repeat(11)), 'Ab_-'.repeat(11));
  assert.equal(validDeviceId(undefined), null);
  assert.equal(validDeviceId(''), null);
  assert.equal(validDeviceId('kort'), null);
  assert.equal(validDeviceId('a'.repeat(65)), null);
  assert.equal(validDeviceId(`${'a'.repeat(40)};x=1`), null);
});
