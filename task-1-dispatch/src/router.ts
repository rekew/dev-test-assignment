// @rev kc-31
import type { Assignment, Branch, Order } from './types.ts';
import { distanceKm } from './geo.ts';

export function assignBranch(order: Order, branches: Branch[]): Assignment {
  const own = branches.filter((b) => b.storeId === order.storeId && b.active);

  if (order.manualBranchId) {
    const manual = own.find((b) => b.id === order.manualBranchId);
    if (manual) return { orderId: order.id, branchId: manual.id, rule: 'manual' };
  }

  if (own.length === 1) {
    return { orderId: order.id, branchId: own[0].id, rule: 'single' };
  }

  if (order.pickupPointId) {
    const pickup = own.find((b) => b.pickupPointIds.includes(order.pickupPointId as string));
    if (pickup) return { orderId: order.id, branchId: pickup.id, rule: 'pickup_point' };
  }

  const inCity = own.filter((b) => b.city === order.city);
  if (inCity.length === 1) {
    return { orderId: order.id, branchId: inCity[0].id, rule: 'city' };
  }

  const pool = inCity.length > 0 ? inCity : own;
  const nearest = findNearest(order, pool);
  if (nearest) return { orderId: order.id, branchId: nearest.id, rule: 'geo' };

  return { orderId: order.id, branchId: null, rule: 'unassigned' };
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
