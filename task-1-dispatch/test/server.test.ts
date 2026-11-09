// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.ts';

test.before(() =>
  new Promise<void>((resolve) => server.listen(0, resolve)),
);

test.after(() =>
  new Promise<void>((resolve) => server.close(() => resolve())),
);

const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

test('POST /orders/:id/assign — заказ уходит по pickup_point', async (t) => {
  const res = await fetch(`${base}/orders/o-101/assign`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { orderId: string; branchId: string; rule: string };
  assert.deepEqual(body, { orderId: 'o-101', branchId: 'b-ala-1', rule: 'pickup_point' });
});

test('POST /orders/:id/assign — повторный вызов не занимает лимит повторно', async (t) => {
  const res = await fetch(`${base}/orders/o-101/assign`, { method: 'POST' });
  const body = (await res.json()) as { orderId: string; branchId: string; rule: string };
  assert.deepEqual(body, { orderId: 'o-101', branchId: 'b-ala-1', rule: 'pickup_point' });

  const load = await fetch(`${base}/branches/b-ala-1/load?date=2026-11-16`);
  assert.equal(load.status, 200);
  const loadBody = (await load.json()) as { assigned: number; limit: number };
  assert.equal(loadBody.assigned, 1);
  assert.equal(loadBody.limit, 3);
});

test('POST /orders/:id/assign — нет заказа → 404', async (t) => {
  const res = await fetch(`${base}/orders/o-999/assign`, { method: 'POST' });
  assert.equal(res.status, 404);
});

test('GET /branches/:id/load — без даты → 400', async (t) => {
  const res = await fetch(`${base}/branches/b-ala-1/load`);
  assert.equal(res.status, 400);
});

test('GET /branches/:id/load — некорректная дата → 400', async (t) => {
  const res = await fetch(`${base}/branches/b-ala-1/load?date=not-a-date`);
  assert.equal(res.status, 400);
});

test('GET /branches/:id/load — нет филиала → 404', async (t) => {
  const res = await fetch(`${base}/branches/b-unknown/load?date=2026-11-16`);
  assert.equal(res.status, 404);
});

test('GET /branches/:id/load — загрузка по дню Алматы', async (t) => {
  const res = await fetch(`${base}/branches/b-ala-1/load?date=2026-11-16`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { branchId: string; date: string; assigned: number; limit: number };
  assert.deepEqual(body, { branchId: 'b-ala-1', date: '2026-11-16', assigned: 1, limit: 3 });
});
