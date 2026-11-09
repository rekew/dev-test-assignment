// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../src/phone.ts';

test('phone: варианты казахстанских номеров', () => {
  const variants = ['+7 701 234 56 78', '87012345678', '8 (701) 234-56-78', '7012345678', '+77012345678'];
  for (const raw of variants) {
    assert.equal(normalizePhone(raw), '+77012345678', raw);
  }
});

test('phone: неверные номера', () => {
  const invalid = ['', '123', '+1 701 234 56 78', 'hello', '+7 601 234 56 78', '8 701 234', null, 87012345678];
  for (const raw of invalid) {
    assert.equal(normalizePhone(raw), null, String(raw));
  }
});
