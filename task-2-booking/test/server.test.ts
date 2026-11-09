import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { server } from '../src/server.ts';

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

test('GET slots: успешный ответ', async () => {
  const prev = process.env.NOW;
  process.env.NOW = '2030-11-17T00:00:00.000Z';
  try {
    const res = await fetch(slotsUrl('m-1', '?serviceId=s-cut&date=2030-11-18'));
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.masterId, 'm-1');
    assert.equal(body.serviceId, 's-cut');
    assert.equal(body.date, '2030-11-18');
    assert.ok(Array.isArray(body.slots));
    assert.ok(body.slots.includes('11:15'));
    assert.ok(!body.slots.includes('10:00'));
  } finally {
    if (prev === undefined) delete process.env.NOW;
    else process.env.NOW = prev;
  }
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
