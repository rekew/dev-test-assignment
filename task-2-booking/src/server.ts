// @rev kc-31
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { normalizePhone } from './phone.ts';
import { getSlots } from './slots.ts';
import { bookingRepo, masters, services } from './store.ts';
import { fromMinutes } from './time.ts';
import type { Booking } from './types.ts';

const port = Number(process.env.PORT ?? 3002);

const TZ_OFFSET_MS = 5 * 60 * 60 * 1000;

// Проверки слотов и вставка идут под очередью, чтобы одновременные запросы
// не смогли занять один и тот же слот.
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  try {
    if (req.method === 'GET' && url.pathname === '/masters') {
      return send(res, 200, masters);
    }

    if (req.method === 'GET' && url.pathname === '/services') {
      return send(res, 200, services);
    }

    const slots = url.pathname.match(/^\/masters\/([^/]+)\/slots$/);
    if (req.method === 'GET' && slots) {
      return handleSlots(res, decodeURIComponent(slots[1]), url.searchParams);
    }

    if (req.method === 'POST' && url.pathname === '/bookings') {
      return handleCreateBooking(req, res);
    }

    send(res, 404, { error: 'not_found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'internal' });
  }
});

async function handleSlots(res: ServerResponse, masterId: string, params: URLSearchParams) {
  const serviceId = params.get('serviceId');
  const date = params.get('date');

  if (!serviceId || !date) return send(res, 400, { error: 'bad_request' });
  if (!isValidDate(date)) return send(res, 400, { error: 'bad_request' });

  const master = masters.find((m) => m.id === masterId);
  if (!master) return send(res, 404, { error: 'not_found' });

  const service = services.find((s) => s.id === serviceId);
  if (!service) return send(res, 404, { error: 'not_found' });
  if (!service.masterIds.includes(master.id)) return send(res, 400, { error: 'bad_request' });

  const bookings = await bookingRepo.listByMaster(master.id);
  send(res, 200, {
    masterId: master.id,
    serviceId: service.id,
    date,
    slots: getSlots(master, service, date, bookings),
  });
}

async function handleCreateBooking(req: IncomingMessage, res: ServerResponse) {
  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 400, { error: 'bad_request' });
  }

  if (!body || typeof body !== 'object') return send(res, 400, { error: 'bad_request' });

  const { masterId, serviceId, start, clientPhone } = body as Record<string, unknown>;
  if (typeof masterId !== 'string' || typeof serviceId !== 'string' || typeof start !== 'string') {
    return send(res, 400, { error: 'bad_request' });
  }

  const phone = normalizePhone(clientPhone);
  if (!phone) return send(res, 400, { error: 'bad_request' });

  const master = masters.find((m) => m.id === masterId);
  if (!master) return send(res, 404, { error: 'not_found' });

  const service = services.find((s) => s.id === serviceId);
  if (!service) return send(res, 404, { error: 'not_found' });
  if (!service.masterIds.includes(master.id)) return send(res, 400, { error: 'bad_request' });

  const slot = toLocalSlot(start);
  if (!slot) return send(res, 400, { error: 'bad_request' });

  const startMs = Date.parse(start);
  const result = await serialize(async () => {
    const bookings = await bookingRepo.listByMaster(master.id);
    const free = getSlots(master, service, slot.date, bookings);
    if (!free.includes(slot.hhmm)) return null;

    const booking: Booking = {
      id: `bk-${randomUUID()}`,
      masterId: master.id,
      serviceId: service.id,
      start: new Date(startMs).toISOString(),
      end: new Date(startMs + service.durationMin * 60000).toISOString(),
      clientPhone: phone,
      status: 'active',
    };
    await bookingRepo.insert(booking);
    return booking;
  });

  if (!result) return send(res, 409, { error: 'slot_unavailable' });
  send(res, 201, result);
}

// ISO-строка с часовым поясом -> местные (Алматы) дата и 'HH:mm'.
function toLocalSlot(start: string): { date: string; hhmm: string } | null {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(start)) return null;

  const ms = Date.parse(start);
  if (Number.isNaN(ms)) return null;

  const local = new Date(ms + TZ_OFFSET_MS);
  if (local.getUTCSeconds() !== 0 || local.getUTCMilliseconds() !== 0) return null;

  return {
    date: local.toISOString().slice(0, 10),
    hhmm: fromMinutes(local.getUTCHours() * 60 + local.getUTCMinutes()),
  };
}

function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, () => {
    console.log(`booking: http://localhost:${port}`);
  });
}
