import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReservedTestAddress, recipientAllowed } from '../../src/lib/email';

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

test('reserverte testdomener får aldri ekte e-post', () => {
  for (const a of ['test-1@example.com', 'X@EXAMPLE.ORG', 'a@example.net', 'a@sub.example.com', 'a@firma.test', 'a@noe.invalid', 'a@host.localhost', 'a@localhost', 'a@demo.example', 'uten-krøllalfa']) {
    assert.equal(isReservedTestAddress(a), true, a);
  }
  for (const a of ['kunde@firma.no', 'hugefot@gmail.com', 'post@example.no', 'a@myexample.com', 'a@testbedrift.no', 'a@test.no']) {
    assert.equal(isReservedTestAddress(a), false, a);
  }
});

test('ukesbrevene får høyst 70 % av døgnkvoten – resten er alltid ledig for innlogging, bekreftelser og varsler', async () => {
  const { newsletterAllowance } = await import('../../src/lib/email');
  assert.equal(newsletterAllowance(100, 0), 70, 'Resends gratisplan: 70 ukesbrev når ingenting annet er sendt');
  assert.equal(newsletterAllowance(100, 25), 45, 'det som er sendt siste døgn, trekkes fra');
  assert.equal(newsletterAllowance(100, 70), 0);
  assert.equal(newsletterAllowance(100, 95), 0, 'aldri negativt');
  assert.equal(newsletterAllowance(3, 0), 2, 'rundes ned');
  assert.equal(newsletterAllowance(50_000, 100), 34_900, 'større plan: EMAIL_DAILY_LIMIT');
});
