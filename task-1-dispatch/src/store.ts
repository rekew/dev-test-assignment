// @rev kc-31
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Assignment, Branch, Order } from './types.ts';
import { almatyDay } from './time.ts';

const dataDir = process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data');

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as T;
}

export const branches: Branch[] = load('branches.json');
export const orders: Order[] = load('orders.json');

// orderId -> распределение
export const assignments = new Map<string, Assignment>();

export function loadFor(branchId: string, day: string): number {
  let count = 0;
  for (const [orderId, assignment] of assignments) {
    if (!assignment.branchId || assignment.branchId !== branchId) continue;
    const order = orders.find((o) => o.id === orderId);
    if (order && almatyDay(order.createdAt) === day) count++;
  }
  return count;
}
