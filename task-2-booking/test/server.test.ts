// @rev kc-31
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { server } from '../src/server.ts';
import { bookingRepo } from '../src/store.ts';

let base: string;

before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

const slotsUrl = (masterId: string, query: string) => `${base}/masters/${masterId}/slots${query}`;

const withNow = async (iso: string, fn: () => Promise<void>) => {
  const prev = process.env.NOW;
  process.env.NOW = iso;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.NOW;
    else process.env.NOW = prev;
  }
};

const postBooking = (body: unknown) =>
  fetch(`${base}/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('GET slots: успешный ответ', async () => {
  await withNow('2030-11-17T00:00:00.000Z', async () => {
    const res = await fetch(slotsUrl('m-1', '?serviceId=s-cut&date=2030-11-18'));
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.masterId, 'm-1');
    assert.equal(body.serviceId, 's-cut');
    assert.equal(body.date, '2030-11-18');
    assert.ok(Array.isArray(body.slots));
    assert.ok(body.slots.includes('11:15'));
    assert.ok(!body.slots.includes('10:00'));
  });
});

test('GET slots: нет serviceId или date — 400', async () => {
  assert.equal((await fetch(slotsUrl('m-1', '?date=2030-11-18'))).status, 400);
  assert.equal((await fetch(slotsUrl('m-1', '?serviceId=s-cut'))).status, 400);
});

test('GET slots: некорректная дата — 400', async () => {
  assert.equal((await fetch(slotsUrl('m-1', '?serviceId=s-cut&date=2030-02-30'))).status, 400);
  assert.equal((await fetch(slotsUrl('m-1', '?serviceId=s-cut&date=18-11-2030'))).status, 400);
});

test('GET slots: нет мастера или услуги — 404', async () => {
  assert.equal((await fetch(slotsUrl('m-404', '?serviceId=s-cut&date=2030-11-18'))).status, 404);
  assert.equal((await fetch(slotsUrl('m-1', '?serviceId=s-404&date=2030-11-18'))).status, 404);
});

test('GET slots: мастер не оказывает услугу — 400', async () => {
  assert.equal((await fetch(slotsUrl('m-1', '?serviceId=s-mani&date=2030-11-18'))).status, 400);
});

test('POST bookings: создаёт запись и нормализует телефон', async () => {
  await withNow('2030-11-17T00:00:00.000Z', async () => {
    const res = await postBooking({
      masterId: 'm-1',
      serviceId: 's-brows',
      start: '2030-11-18T15:00:00+05:00',
      clientPhone: '+7 701 234 56 78',
    });
    assert.equal(res.status, 201);

    const body = await res.json();
    assert.match(body.id, /^bk-/);
    assert.equal(body.masterId, 'm-1');
    assert.equal(body.serviceId, 's-brows');
    assert.equal(body.start, '2030-11-18T10:00:00.000Z');
    assert.equal(body.end, '2030-11-18T10:30:00.000Z');
    assert.equal(body.clientPhone, '+77012345678');
    assert.equal(body.status, 'active');
  });
});

test('POST bookings: неверный телефон — 400', async () => {
  const res = await postBooking({
    masterId: 'm-1',
    serviceId: 's-brows',
    start: '2030-11-18T15:00:00+05:00',
    clientPhone: '+1 701 234 56 78',
  });
  assert.equal(res.status, 400);
});

test('POST bookings: некорректный start — 400', async () => {
  const body = { masterId: 'm-1', serviceId: 's-brows', clientPhone: '87012345678' };

  assert.equal((await postBooking({ ...body, start: '2030-11-18T15:00:00' })).status, 400);
  assert.equal((await postBooking({ ...body, start: '2030-11-18T15:00:30+05:00' })).status, 400);
  assert.equal((await postBooking({ ...body, start: 'not-a-date' })).status, 400);
});

test('POST bookings: нет обязательных полей — 400', async () => {
  assert.equal((await postBooking({ serviceId: 's-brows', start: '2030-11-18T15:00:00+05:00' })).status, 400);
  assert.equal((await postBooking('not json')).status, 400);
});

test('POST bookings: нет мастера или услуги — 404', async () => {
  const base = {
    serviceId: 's-brows',
    start: '2030-11-18T15:00:00+05:00',
    clientPhone: '87012345678',
  };
  assert.equal((await postBooking({ ...base, masterId: 'm-404' })).status, 404);
  assert.equal((await postBooking({ ...base, masterId: 'm-1', serviceId: 's-404' })).status, 404);
});

test('POST bookings: мастер не оказывает услугу — 400', async () => {
  const res = await postBooking({
    masterId: 'm-1',
    serviceId: 's-mani',
    start: '2030-11-18T15:00:00+05:00',
    clientPhone: '87012345678',
  });
  assert.equal(res.status, 400);
});

test('POST bookings: время не из свободных слотов — 409', async () => {
  await withNow('2030-11-17T00:00:00.000Z', async () => {
    // 14:00–15:00 у мастера перерыв
    const res = await postBooking({
      masterId: 'm-1',
      serviceId: 's-cut',
      start: '2030-11-18T14:00:00+05:00',
      clientPhone: '87012345678',
    });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'slot_unavailable' });
  });
});

const deleteBooking = (id: string) => fetch(`${base}/bookings/${id}`, { method: 'DELETE' });

test('DELETE bookings: отменяет запись, повторная отмена — 200', async () => {
  await withNow('2030-11-17T00:00:00.000Z', async () => {
    const created = await (
      await postBooking({
        masterId: 'm-1',
        serviceId: 's-cut',
        start: '2030-11-18T16:00:00+05:00',
        clientPhone: '87012345678',
      })
    ).json();

    const first = await deleteBooking(created.id);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).status, 'cancelled');

    const second = await deleteBooking(created.id);
    assert.equal(second.status, 200);
    assert.equal((await second.json()).status, 'cancelled');
  });
});

test('DELETE bookings: меньше чем за 2 часа — 409 too_late', async () => {
  let id = '';
  await withNow('2030-11-17T00:00:00.000Z', async () => {
    const created = await (
      await postBooking({
        masterId: 'm-1',
        serviceId: 's-cut',
        start: '2030-11-19T10:00:00+05:00',
        clientPhone: '87012345678',
      })
    ).json();
    id = created.id;
  });

  // 09:00 по Алматы, до начала 1 час
  await withNow('2030-11-19T04:00:00.000Z', async () => {
    const res = await deleteBooking(id);
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'too_late' });
  });
});

test('DELETE bookings: ровно за 2 часа отменить можно', async () => {
  let id = '';
  await withNow('2030-11-17T00:00:00.000Z', async () => {
    const created = await (
      await postBooking({
        masterId: 'm-1',
        serviceId: 's-cut',
        start: '2030-11-19T11:30:00+05:00',
        clientPhone: '87012345678',
      })
    ).json();
    id = created.id;
  });

  // 09:30 по Алматы, до начала ровно 2 часа
  await withNow('2030-11-19T04:30:00.000Z', async () => {
    const res = await deleteBooking(id);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'cancelled');
  });
});

test('DELETE bookings: нет такой записи — 404', async () => {
  const res = await deleteBooking('bk-missing');
  assert.equal(res.status, 404);
});

test('POST bookings: одновременная бронь одного слота создаёт одну запись', async () => {
  await withNow('2030-11-17T00:00:00.000Z', async () => {
    const request = {
      masterId: 'm-2',
      serviceId: 's-mani',
      start: '2030-11-20T10:00:00+05:00',
      clientPhone: '87012345678',
    };

    const [first, second] = await Promise.all([postBooking(request), postBooking(request)]);
    assert.deepEqual([first.status, second.status].sort(), [201, 409]);

    const bookings = await bookingRepo.listByMaster('m-2');
    const sameSlot = bookings.filter(
      (booking) => booking.start === '2030-11-20T05:00:00.000Z' && booking.status === 'active',
    );
    assert.equal(sameSlot.length, 1);
  });
});
