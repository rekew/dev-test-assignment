import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { getSlots } from './slots.ts';
import { bookingRepo, masters, services } from './store.ts';

const port = Number(process.env.PORT ?? 3002);

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
