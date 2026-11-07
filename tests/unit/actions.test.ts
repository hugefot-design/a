import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarDaysUntil, sortActions, type ActionItem } from '../../src/domain/actions';

const item = (over: Partial<ActionItem>): ActionItem => ({ kind: 'frist', title: 't', detail: 'd', href: '/', due: null, urgency: 'snart', ...over });

test('til handling: det som haster først, så tidligste tidspunkt – punkter uten tidspunkt sist i sin gruppe', () => {
  const sorted = sortActions([
    item({ detail: 'info', urgency: 'info', due: new Date('2026-11-08') }),
    item({ detail: 'snart uten dato', urgency: 'snart' }),
    item({ detail: 'snart sent', urgency: 'snart', due: new Date('2026-11-12') }),
    item({ detail: 'haster', urgency: 'haster', due: new Date('2026-11-09') }),
    item({ detail: 'snart tidlig', urgency: 'snart', due: new Date('2026-11-10') }),
  ]);
  assert.deepEqual(
    sorted.map((i) => i.detail),
    ['haster', 'snart tidlig', 'snart sent', 'snart uten dato', 'info'],
  );
});

test('kalenderdager i norsk tid: rett før midnatt er neste morgen «i morgen», ikke «i dag»', () => {
  const now = new Date('2026-11-07T22:30:00Z'); // 23:30 i Oslo
  assert.equal(calendarDaysUntil(new Date('2026-11-08T06:00:00Z'), now), 1, '07:00 neste dag');
  assert.equal(calendarDaysUntil(new Date('2026-11-07T22:50:00Z'), now), 0, 'samme kveld');
  assert.equal(calendarDaysUntil(new Date('2026-11-09T22:00:00Z'), now), 2, '23:00 to dager senere');
  // Sommertid: 30. mars 2026 kl. 23:30 i Oslo er 21:30 UTC.
  assert.equal(calendarDaysUntil(new Date('2026-03-31T05:00:00Z'), new Date('2026-03-30T21:30:00Z')), 1);
});
