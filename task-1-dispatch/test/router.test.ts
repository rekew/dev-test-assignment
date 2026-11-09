// @rev kc-31
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignBranch } from '../src/router.ts';
import { distanceKm } from '../src/geo.ts';
import { almatyDay } from '../src/time.ts';
import type { Branch, Order } from '../src/types.ts';

const branch = (over: Partial<Branch>): Branch => ({
  id: 'b-1',
  storeId: 's-1',
  name: 'Филиал',
  city: 'Алматы',
  lat: 43.24,
  lon: 76.91,
  active: true,
  pickupPointIds: [],
  dailyLimit: 100,
  ...over,
});

const order = (over: Partial<Order>): Order => ({
  id: 'o-1',
  storeId: 's-1',
  city: 'Алматы',
  lat: 43.25,
  lon: 76.92,
  pickupPointId: null,
  manualBranchId: null,
  createdAt: '2026-11-16T06:00:00Z',
  ...over,
});

const almaty = branch({ id: 'b-ala', city: 'Алматы', lat: 43.2567, lon: 76.9286 });
const astana = branch({ id: 'b-ast', city: 'Астана', lat: 51.128, lon: 71.43 });

test('distanceKm: Алматы — Астана около 970 км', () => {
  const d = distanceKm(43.2389, 76.8897, 51.1694, 71.4491);
  assert.ok(Math.abs(d - 970) < 15, `получили ${d.toFixed(1)}`);
});

test('manual: заказ уходит в указанный филиал', () => {
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'manual' });
});

test('manual: неактивный филиал пропускается', () => {
  const closed = { ...astana, active: false };
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, closed]);
  assert.notEqual(res.rule, 'manual');
});

test('single: у магазина один активный филиал', () => {
  const res = assignBranch(order({ city: 'Шымкент' }), [almaty]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'single' });
});

test('geo: выбирается ближайший филиал', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: 43.25, lon: 76.93 }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'geo' });
});

test('geo: без координат заказ не распределяется', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: null, lon: null }), [almaty, astana]);
  assert.equal(res.rule, 'unassigned');
});

test('pickup_point: пункт выдачи закреплён за филиалом', () => {
  const pickupBranch = branch({
    id: 'b-pp',
    city: 'Астана',
    lat: 51.128,
    lon: 71.43,
    pickupPointIds: ['pp-1'],
  });
  const res = assignBranch(order({ pickupPointId: 'pp-1' }), [almaty, pickupBranch]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-pp', rule: 'pickup_point' });
});

test('pickup_point: неизвестный пункт выдачи пропускается', () => {
  const res = assignBranch(order({ pickupPointId: 'pp-unknown' }), [almaty, astana]);
  assert.equal(res.rule, 'city');
  assert.equal(res.branchId, 'b-ala');
});

test('city: в городе заказа один филиал магазина', () => {
  const res = assignBranch(order({ city: 'Астана' }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'city' });
});

test('geo: если в городе несколько филиалов, выбирается ближайший из них', () => {
  const almaty2 = branch({ id: 'b-ala-2', city: 'Алматы', lat: 43.3, lon: 76.95 });
  const nearOtherCity = branch({ id: 'b-near', city: 'Конаев', lat: 43.251, lon: 76.921 });
  const res = assignBranch(order({ city: 'Алматы', lat: 43.251, lon: 76.921 }), [
    almaty,
    almaty2,
    nearOtherCity,
  ]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'geo' });
});

test('лимит: заполненный филиал пропускается', () => {
  const full = branch({
    id: 'b-full',
    city: 'Астана',
    lat: 51.128,
    lon: 71.43,
    pickupPointIds: ['pp-1'],
    dailyLimit: 1,
  });
  const free = branch({ id: 'b-free', city: 'Астана', lat: 51.2, lon: 71.5, dailyLimit: 10 });
  const res = assignBranch(
    order({ city: 'Астана', lat: 51.13, lon: 71.43, pickupPointId: 'pp-1' }),
    [full, free],
    (id) => (id === 'b-full' ? 1 : 0),
  );
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-free', rule: 'geo' });
});

test('лимит: fallback предпочитает незаполненный филиал в городе заказа', () => {
  const full = branch({ id: 'b-x1', city: 'X', lat: 43.25, lon: 76.92, dailyLimit: 1 });
  const sameCity = branch({ id: 'b-x2', city: 'X', lat: 43.5, lon: 77.2, dailyLimit: 10 });
  const otherCity = branch({ id: 'b-y', city: 'Y', lat: 43.251, lon: 76.921, dailyLimit: 10 });
  const res = assignBranch(
    order({ city: 'X', lat: 43.25, lon: 76.92 }),
    [full, sameCity, otherCity],
    (id) => (id === 'b-x1' ? 1 : 0),
  );
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-x2', rule: 'geo' });
});

test('лимит: единственный филиал заполнен — заказ не распределяется', () => {
  const only = branch({ id: 'b-only', dailyLimit: 1 });
  const res = assignBranch(order({}), [only], () => 1);
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'unassigned' });
});

test('лимит: все филиалы заполнены — заказ не распределяется', () => {
  const a = branch({ id: 'b-1', city: 'Алматы', lat: 43.25, lon: 76.92, dailyLimit: 1 });
  const b = branch({ id: 'b-2', city: 'Алматы', lat: 43.26, lon: 76.93, dailyLimit: 1 });
  const res = assignBranch(order({}), [a, b], () => 1);
  assert.deepEqual(res, { orderId: 'o-1', branchId: null, rule: 'unassigned' });
});

test('лимит: manual не проверяет лимит', () => {
  const full = branch({ id: 'b-ast', city: 'Астана', dailyLimit: 1 });
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, full], () => 999);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'manual' });
});

test('лимит: загрузка считается по дню Алматы', () => {
  const only = branch({ id: 'b-only', dailyLimit: 1 });
  const days: string[] = [];
  assignBranch(order({ createdAt: '2026-11-15T19:30:00Z' }), [only], (_id, day) => {
    days.push(day);
    return 1;
  });
  assert.ok(days.length > 0);
  assert.ok(days.every((d) => d === '2026-11-16'));
});

test('almatyDay: сутки по Алматы UTC+5', () => {
  assert.equal(almatyDay('2026-11-15T19:30:00Z'), '2026-11-16');
  assert.equal(almatyDay('2026-11-16T18:59:59Z'), '2026-11-16');
  assert.equal(almatyDay('2026-11-16T19:00:00Z'), '2026-11-17');
});
