import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import { config } from './config';

const url = (path: string) => `${config.apiUrl}${path}`;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface Owner {
  email: string;
  idToken: string;
}

export interface Dish {
  id: string;
  name: string;
  price: number;
}

export interface Participant {
  id: string;
  type: 'Owner' | 'Guest';
  name: string;
  items: { dish: Dish; quantity: number }[];
  total: number;
  isSubmitted: boolean;
}

export interface Snapshot {
  participants: Participant[];
  total: number;
}

export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// Some endpoints of this backend answer in PascalCase (e.g. GroupReservationId) and some in camelCase.
// Keys are normalised to camelCase here, so the tests do not depend on that inconsistency.
function camelize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k.charAt(0).toLowerCase() + k.slice(1), camelize(v)]),
    );
  }
  return value;
}

export async function parse<T>(res: APIResponse): Promise<T> {
  return camelize(JSON.parse(await res.text())) as T;
}

async function json<T>(res: APIResponse, expectedStatus: number): Promise<T> {
  const body = await res.text();
  expect(res.status(), `unexpected status, body: ${body}`).toBe(expectedStatus);
  return camelize(JSON.parse(body)) as T;
}

// ---------- owner account ----------

export async function getOwner(request: APIRequestContext): Promise<Owner> {
  if (config.ownerEmail && config.ownerPassword) {
    return signIn(request, config.ownerEmail, config.ownerPassword);
  }
  // no fixed account: register a fresh customer, so runs never depend on each other
  const email = `qa.owner.${uniqueSuffix()}@example.com`;
  const password = 'Qa!Passw0rd-2026';
  const reg = await request.post(url('/register'), {
    data: { firstName: 'Qa', lastName: 'Owner', email, password, confirmPassword: password },
  });
  expect(reg.status(), `register failed: ${await reg.text()}`).toBe(200);
  return signIn(request, email, password);
}

export async function signIn(request: APIRequestContext, email: string, password: string): Promise<Owner> {
  const res = await request.post(url('/signin'), { data: { email, password } });
  const body = await json<{ idToken: string }>(res, 200);
  return { email, idToken: body.idToken };
}

// ---------- location, table, dishes ----------

export async function pickLocationId(request: APIRequestContext): Promise<string> {
  if (config.locationId) return config.locationId;
  const locations = await json<{ id: string }[]>(await request.get(url('/locations')), 200);
  expect(locations.length, 'no locations in the environment').toBeGreaterThan(0);
  return locations[0].id;
}

export async function getDishes(request: APIRequestContext, locationId: string, count = 2): Promise<Dish[]> {
  const dishes = await json<Dish[]>(await request.get(url(`/locations/${locationId}/dishes`)), 200);
  expect(dishes.length, 'location has too few dishes').toBeGreaterThanOrEqual(count);
  return dishes.slice(0, count);
}

// ---------- reservation / order ----------

export interface Reservation {
  id: string;
  tableId: string;
}

/**
 * Creates a reservation in a random future slot. Slots are random so parallel runs
 * and previous runs rarely collide; if a slot is taken we simply try the next one.
 */
export async function createReservation(
  request: APIRequestContext,
  owner: Owner,
  locationId: string,
  guestCount = 6,
): Promise<Reservation> {
  const errors: string[] = [];
  for (let attempt = 0; attempt < 15; attempt++) {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 3 + Math.floor(Math.random() * 300));
    start.setUTCHours(10 + Math.floor(Math.random() * 8), 0, 0, 0);
    const end = new Date(start.getTime() + 90 * 60 * 1000);

    // the invite is refused when the group is full, so we need a table for a bigger party.
    // If no such table exists, we fall back to smaller parties (3 is the minimum for two guests).
    const partySize = [guestCount, 4, 3][Math.floor(attempt / 5) % 3];
    const tablesRes = await request.get(url('/available-tables'), {
      params: { locationId, capacity: partySize, startTime: start.toISOString() },
    });
    if (tablesRes.status() !== 200) {
      errors.push(`tables ${tablesRes.status()}`);
      continue;
    }
    const tables = await parse<{ id: string }[]>(tablesRes);
    if (tables.length === 0) continue;

    const res = await request.post(url('/reservations'), {
      headers: bearer(owner.idToken),
      data: {
        tableId: tables[0].id,
        customerEmail: owner.email,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        guestCount: partySize,
      },
    });
    if (res.status() === 201) {
      const body = await parse<{ id: string; tableId: string }>(res);
      return { id: body.id, tableId: body.tableId };
    }
    errors.push(`reserve ${res.status()}: ${await res.text()}`);
  }
  throw new Error(`could not create a reservation: ${errors.join(' | ')}`);
}

export async function createOrder(
  request: APIRequestContext,
  owner: Owner,
  reservationId: string,
  dishes: Dish[],
): Promise<void> {
  const res = await request.post(url('/orders'), {
    headers: bearer(owner.idToken),
    data: { reservationId, orderItems: dishes.map((d) => ({ dishId: d.id, quantity: 1 })) },
  });
  expect(res.status(), `create order failed: ${await res.text()}`).toBe(201);
}

export async function cancelReservation(request: APIRequestContext, owner: Owner, reservationId: string) {
  // best effort cleanup, must never fail a test
  await request
    .delete(url('/reservations'), { headers: bearer(owner.idToken), data: { id: reservationId } })
    .catch(() => undefined);
}

// ---------- group pre-order ----------

export async function getGroupReservationId(request: APIRequestContext, owner: Owner, reservationId: string) {
  const invite = await json<{ token: string }>(
    await request.get(url(`/reservations/${reservationId}/invite-token`), { headers: bearer(owner.idToken) }),
    200,
  );
  const info = await json<{ groupReservationId: string }>(await request.get(url(`/guest/invites/${invite.token}`)), 200);
  return info.groupReservationId;
}

export async function getOwnerSessionId(request: APIRequestContext, owner: Owner, reservationId: string) {
  const res = await json<{ guestSessionId: string }>(
    await request.get(url(`/reservations/${reservationId}/guest-session-id`), { headers: bearer(owner.idToken) }),
    200,
  );
  return res.guestSessionId;
}

export interface Guest {
  name: string;
  sessionId: string;
  sessionToken: string;
}

export async function joinAsGuest(request: APIRequestContext, groupId: string, name: string): Promise<Guest> {
  const res = await request.post(url('/guest/sessions'), { data: { groupReservationId: groupId, guestName: name } });
  // the API docs say 201, the deployed backend answers 200 (noted in README)
  const body = await json<{ sessionId: string; sessionToken: string }>(res, 200);
  return { name, sessionId: body.sessionId, sessionToken: body.sessionToken };
}

export function addDish(request: APIRequestContext, guest: Guest, dishId: string, quantity: number) {
  return request.post(url(`/guest/sessions/${guest.sessionId}/dishes`), {
    headers: bearer(guest.sessionToken),
    data: { dishId, quantity },
  });
}

export function removeDish(request: APIRequestContext, guest: Guest, dishId: string, quantity: number) {
  return request.delete(url(`/guest/sessions/${guest.sessionId}/dishes`), {
    headers: bearer(guest.sessionToken),
    data: { dishId, quantity },
  });
}

export function submitGuestCart(request: APIRequestContext, guest: Guest) {
  return request.post(url(`/guest/sessions/${guest.sessionId}/submit`), { headers: bearer(guest.sessionToken) });
}

export function getSnapshotRaw(request: APIRequestContext, groupId: string, token?: string) {
  return request.get(url(`/guest/groups/${groupId}/sessions`), { headers: token ? bearer(token) : {} });
}

export async function getSnapshot(request: APIRequestContext, owner: Owner, groupId: string): Promise<Snapshot> {
  return json<Snapshot>(await getSnapshotRaw(request, groupId, owner.idToken), 200);
}

export function submitGroup(request: APIRequestContext, groupId: string, reservationId: string, token?: string) {
  return request.post(url(`/group-reservations/${groupId}/submit`), {
    headers: token ? bearer(token) : {},
    data: { reservationId },
  });
}

export function deleteParticipant(request: APIRequestContext, groupId: string, sessionId: string, token?: string) {
  return request.delete(url(`/guest/groups/${groupId}/sessions/${sessionId}`), {
    headers: token ? bearer(token) : {},
  });
}
