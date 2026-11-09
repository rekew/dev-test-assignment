// @rev kc-31
import type { Assignment, Branch, Order } from './types.ts';
import { distanceKm } from './geo.ts';
import { almatyDay } from './time.ts';

type GetLoad = (branchId: string, day: string) => number;

const noLoad: GetLoad = () => 0;

export function assignBranch(
  order: Order,
  branches: Branch[],
  getLoad: GetLoad = noLoad,
): Assignment {
  const own = branches.filter((b) => b.storeId === order.storeId && b.active);
  const day = almatyDay(order.createdAt);
  const isFull = (b: Branch) => getLoad(b.id, day) >= b.dailyLimit;

  if (order.manualBranchId) {
    const manual = own.find((b) => b.id === order.manualBranchId);
    if (manual) return { orderId: order.id, branchId: manual.id, rule: 'manual' };
  }

  const selected = selectByRule(order, own);
  if (selected && !isFull(selected.branch)) {
    return { orderId: order.id, branchId: selected.branch.id, rule: selected.rule };
  }

  const fallback = findNearestAvailable(order, own, isFull);
  if (fallback) return { orderId: order.id, branchId: fallback.id, rule: 'geo' };

  return { orderId: order.id, branchId: null, rule: 'unassigned' };
}

function selectByRule(
  order: Order,
  own: Branch[],
): { branch: Branch; rule: Assignment['rule'] } | null {
  if (own.length === 1) return { branch: own[0], rule: 'single' };

  if (order.pickupPointId) {
    const pickup = own.find((b) => b.pickupPointIds.includes(order.pickupPointId as string));
    if (pickup) return { branch: pickup, rule: 'pickup_point' };
  }

  const inCity = own.filter((b) => b.city === order.city);
  if (inCity.length === 1) return { branch: inCity[0], rule: 'city' };

  const pool = inCity.length > 0 ? inCity : own;
  const nearest = findNearest(order, pool);
  if (nearest) return { branch: nearest, rule: 'geo' };

  return null;
}

function findNearestAvailable(
  order: Order,
  own: Branch[],
  isFull: (b: Branch) => boolean,
): Branch | null {
  const available = own.filter((b) => !isFull(b));
  if (available.length === 0) return null;

  const inCity = available.filter((b) => b.city === order.city);
  const pool = inCity.length > 0 ? inCity : available;
  return findNearest(order, pool);
}

function findNearest(order: Order, branches: Branch[]): Branch | null {
  if (order.lat === null || order.lon === null) return null;

  let best: Branch | null = null;
  let bestDist = Infinity;
  for (const b of branches) {
    const d = distanceKm(order.lat, order.lon, b.lat, b.lon);
    if (d < bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}
