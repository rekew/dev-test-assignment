import { now } from './clock.ts';
import type { Booking, Master, Service, TimeRange } from './types.ts';
import { TZ_OFFSET, fromMinutes, overlaps, toMinutes, weekday, type Range } from './time.ts';

export const SLOT_STEP_MIN = 15;
export const CLEANING_BUFFER_MIN = 7;

const TZ_OFFSET_MS = 5 * 60 * 60 * 1000;

function toRange(range: TimeRange): Range {
  return { start: toMinutes(range.from), end: toMinutes(range.to) };
}

// Активная запись блокирует себя и ещё CLEANING_BUFFER_MIN минут после окончания.
// Время в booking хранится в UTC, поэтому переводим его в местное (Алматы).
function bookedRange(booking: Booking, date: string): Range | null {
  const start = new Date(new Date(booking.start).getTime() + TZ_OFFSET_MS);
  const localDate = start.toISOString().slice(0, 10);
  if (localDate !== date) return null;

  const from = start.getUTCHours() * 60 + start.getUTCMinutes();
  const durationMin = (new Date(booking.end).getTime() - new Date(booking.start).getTime()) / 60000;
  return { start: from, end: from + durationMin + CLEANING_BUFFER_MIN };
}

function slotInstant(date: string, minute: number): number {
  return new Date(`${date}T${fromMinutes(minute)}:00${TZ_OFFSET}`).getTime();
}

// Свободные слоты мастера на дату, 'HH:mm' по Алматы
export function getSlots(master: Master, service: Service, date: string, bookings: Booking[]): string[] {
  const day = master.schedule[weekday(date)];
  if (!day) return [];

  const result: string[] = [];
  const end = toMinutes(day.to);
  const nowMs = now().getTime();
  const breaks = day.breaks.map(toRange);
  const busy = bookings
    .filter((booking) => booking.status === 'active')
    .map((booking) => bookedRange(booking, date))
    .filter((range): range is Range => range !== null);

  for (let t = toMinutes(day.from); t + service.durationMin <= end; t += SLOT_STEP_MIN) {
    const slot: Range = { start: t, end: t + service.durationMin };
    if (breaks.some((br) => overlaps(slot, br))) continue;
    if (busy.some((range) => overlaps(slot, range))) continue;
    if (slotInstant(date, t) <= nowMs) continue;

    result.push(fromMinutes(t));
  }

  return result;
}
