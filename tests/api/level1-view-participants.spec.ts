import { test, expect } from '../../src/fixtures';
import {
  addDish, getOwner, removeDish, getOwnerSessionId, getSnapshot, getSnapshotRaw, joinAsGuest, submitGuestCart,
} from '../../src/api';

test.describe('Level 1: Owner views participants of the group pre-order', () => {
  test('@smoke empty group returns no participants and zero total', async ({ request, group }) => {
    const snapshot = await getSnapshot(request, group.owner, group.groupId);
    expect(snapshot.participants).toEqual([]);
    expect(snapshot.total).toBe(0);
  });

  test('@smoke guest with dishes is listed with items and personal total', async ({ request, group }) => {
    const guest = await joinAsGuest(request, group.groupId, 'Andrii');
    const [first, second] = group.dishes;
    expect((await addDish(request, guest, first.id, 2)).status()).toBe(200);
    expect((await addDish(request, guest, second.id, 1)).status()).toBe(200);

    const snapshot = await getSnapshot(request, group.owner, group.groupId);
    const row = snapshot.participants.find((p) => p.id === guest.sessionId);

    expect(row, 'guest is missing in the snapshot').toBeDefined();
    expect(row!.type).toBe('Guest');
    expect(row!.name).toBe('Andrii');
    expect(row!.items).toHaveLength(2);
    expect(row!.total).toBeCloseTo(first.price * 2 + second.price, 2);
    expect(snapshot.total).toBeCloseTo(row!.total, 2);
  });

  test('owner and guests are shown together, overall total is the sum of personal totals', async ({ request, group }) => {
    const ownerSessionId = await getOwnerSessionId(request, group.owner, group.reservationId);
    const guestA = await joinAsGuest(request, group.groupId, 'Olena');
    const guestB = await joinAsGuest(request, group.groupId, 'Taras');
    await addDish(request, guestA, group.dishes[0].id, 1);
    await addDish(request, guestB, group.dishes[1].id, 3);

    const snapshot = await getSnapshot(request, group.owner, group.groupId);

    expect(snapshot.participants.map((p) => p.type).sort()).toEqual(['Guest', 'Guest', 'Owner']);
    expect(snapshot.participants.some((p) => p.id === ownerSessionId && p.type === 'Owner')).toBe(true);
    const sum = snapshot.participants.reduce((acc, p) => acc + p.total, 0);
    expect(snapshot.total).toBeCloseTo(sum, 2);
  });

  test('overall total changes when a guest changes the cart', async ({ request, group }) => {
    const guest = await joinAsGuest(request, group.groupId, 'Changer');
    const dish = group.dishes[0];
    await addDish(request, guest, dish.id, 3);
    expect((await getSnapshot(request, group.owner, group.groupId)).total).toBeCloseTo(dish.price * 3, 2);

    expect((await removeDish(request, guest, dish.id, 1)).status()).toBe(200);

    const after = await getSnapshot(request, group.owner, group.groupId);
    expect(after.total).toBeCloseTo(dish.price * 2, 2);
  });

  test('isSubmitted turns true only after the guest submits the cart', async ({ request, group }) => {
    const guest = await joinAsGuest(request, group.groupId, 'Iryna');
    await addDish(request, guest, group.dishes[0].id, 1);

    const before = await getSnapshot(request, group.owner, group.groupId);
    expect(before.participants.find((p) => p.id === guest.sessionId)!.isSubmitted).toBe(false);

    expect((await submitGuestCart(request, guest)).status()).toBe(200);

    const after = await getSnapshot(request, group.owner, group.groupId);
    expect(after.participants.find((p) => p.id === guest.sessionId)!.isSubmitted).toBe(true);
  });

  test('guest without dishes is still listed with zero total', async ({ request, group }) => {
    const guest = await joinAsGuest(request, group.groupId, 'Empty Guest');
    const snapshot = await getSnapshot(request, group.owner, group.groupId);
    const row = snapshot.participants.find((p) => p.id === guest.sessionId);
    expect(row?.items).toEqual([]);
    expect(row?.total).toBe(0);
  });

  test.describe('negative', () => {
    test('request without token is rejected with 401', async ({ request, group }) => {
      const res = await getSnapshotRaw(request, group.groupId);
      expect(res.status()).toBe(401);
    });

    test('another customer (not the owner) gets 403', async ({ request, group }) => {
      const stranger = await getOwner(request);
      const res = await getSnapshotRaw(request, group.groupId, stranger.idToken);
      expect(res.status()).toBe(403);
    });

    test('guest token cannot be used to read the group', async ({ request, group }) => {
      const guest = await joinAsGuest(request, group.groupId, 'Sneaky');
      const res = await getSnapshotRaw(request, group.groupId, guest.sessionToken);
      expect([401, 403]).toContain(res.status());
    });

    test('unknown group id returns 404', async ({ request, group }) => {
      const res = await getSnapshotRaw(request, 'does-not-exist-123', group.owner.idToken);
      expect(res.status()).toBe(404);
    });
  });
});
