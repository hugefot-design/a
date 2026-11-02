import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recipientAllowed } from '../../src/lib/email';

test('testlisten: bare listede adresser (eller domener) får e-post; uten liste får alle', () => {
  const list = 'eier@firma.no, Test@Example.com ; @testbedrift.no';
  assert.equal(recipientAllowed('eier@firma.no', list), true);
  assert.equal(recipientAllowed('test@example.com', list), true, 'store/små bokstaver spiller ingen rolle');
  assert.equal(recipientAllowed('hvem.som.helst@testbedrift.no', list), true, 'hele domenet');
  assert.equal(recipientAllowed('kunde@firma.no', list), false);
  assert.equal(recipientAllowed('eier@firma.no.svindel.com', list), false);
  assert.equal(recipientAllowed('noen@nottestbedrift.no', list), false, 'domenet må stemme helt');
  assert.equal(recipientAllowed('kunde@firma.no', undefined), true);
  assert.equal(recipientAllowed('kunde@firma.no', '  '), true);
});
