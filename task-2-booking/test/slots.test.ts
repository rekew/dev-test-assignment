import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSlots } from '../src/slots.ts';
import { overlaps, toMinutes } from '../src/time.ts';
import type { Booking, Master, Service, WorkDay } from '../src/types.ts';

const day: WorkDay = { from: '10:00', to: '13:00', breaks: [] };

const master: Master = {
  id: 'm-1',
  name: 'Тест',
  schedule: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: null, sun: null },
};

const monday = '2030-11-18';

const cut: Service = { id: 's-cut', name: 'Стрижка', durationMin: 60, masterIds: ['m-1'] };

const range = (from: string, to: string) => ({ start: toMinutes(from), end: toMinutes(to) });

const withDay = (patch: Partial<WorkDay>): Master => ({
  ...master,
  schedule: { ...master.schedule, mon: { ...day, ...patch } },
});

const booking = (startLocal: string, endLocal: string, status: Booking['status'] = 'active'): Booking => {
  const toUtc = (local: string) => new Date(`${monday}T${local}:00+05:00`).toISOString();
  return {
    id: 'bk-test',
    masterId: 'm-1',
    serviceId: 's-cut',
    start: toUtc(startLocal),
    end: toUtc(endLocal),
    clientPhone: '+77012345678',
    status,
  };
};

const withNow = async (iso: string, fn: () => void | Promise<void>) => {
  const prev = process.env.NOW;
  process.env.NOW = iso;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.NOW;
    else process.env.NOW = prev;
  }
};

test('overlaps: пересекающиеся интервалы', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('10:30', '11:30')), true);
});

test('overlaps: запись сразу после другой не пересекается', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('11:00', '12:00')), false);
});

test('getSlots: свободный день', () => {
  // 2030-11-18 — понедельник
  const slots = getSlots(master, cut, monday, []);
  assert.deepEqual(slots, ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '12:00']);
});

test('getSlots: выходной', () => {
  assert.deepEqual(getSlots(master, cut, '2030-11-23', []), []);
});

test('getSlots: слот не пересекает перерыв', () => {
  const withBreak = withDay({ breaks: [{ from: '11:00', to: '11:30' }] });
  const short: Service = { id: 's-30', name: 'Короткая', durationMin: 30, masterIds: ['m-1'] };
  const slots = getSlots(withBreak, short, monday, []);
  assert.deepEqual(slots, ['10:00', '10:15', '10:30', '11:30', '11:45', '12:00', '12:15', '12:30']);
});

test('getSlots: занятое время не выдаётся, отменённые записи не мешают', () => {
  const bookings = [booking('10:00', '11:00'), booking('12:00', '13:00', 'cancelled')];
  const slots = getSlots(master, cut, monday, bookings);
  assert.deepEqual(slots, ['11:15', '11:30', '11:45', '12:00']);
});

test('getSlots: после записи 7 минут на уборку не выдаются', () => {
  const short: Service = { id: 's-30', name: 'Короткая', durationMin: 30, masterIds: ['m-1'] };
  const slots = getSlots(master, short, monday, [booking('10:00', '10:30')]);
  assert.ok(!slots.includes('10:30'));
  assert.ok(slots.includes('10:45'));
});

test('getSlots: прошедшее время не выдаётся', async () => {
  // 10:30 по Алматы
  await withNow('2030-11-18T05:30:00.000Z', () => {
    const slots = getSlots(master, cut, monday, []);
    assert.deepEqual(slots, ['10:45', '11:00', '11:15', '11:30', '11:45', '12:00']);
  });
});
