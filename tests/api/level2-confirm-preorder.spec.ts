import { test, expect } from '../../src/fixtures';
import {
  addDish, getOwner, joinAsGuest, parse, submitGroup, submitGuestCart,
} from '../../src/api';

test.describe('Level 2: Owner confirms the consolidated pre-order', () => {
  test('@smoke identical dishes of different guests are merged by dishId', async ({ request, group }) => {
    const [first, second] = group.dishes;
    const a = await joinAsGuest(request, group.groupId, 'Andrii');
    const b = await joinAsGuest(request, group.groupId, 'Olena');
    await addDish(request, a, first.id, 2);
    await addDish(request, a, second.id, 1);
    await addDish(request, b, first.id, 3);
    expect((await submitGuestCart(request, a)).status()).toBe(200);
    expect((await submitGuestCart(request, b)).status()).toBe(200);

    const res = await submitGroup(request, group.groupId, group.reservationId, group.owner.idToken);
    expect(res.status()).toBe(200);
    const merged = await parse<{ dishId: string; quantity: number }[]>(res);

    expect(merged).toHaveLength(2);
    expect(merged.find((d) => d.dishId === first.id)?.quantity).toBe(5);
    expect(merged.find((d) => d.dishId === second.id)?.quantity).toBe(1);
  });

  test('guests who did not submit are not included', async ({ request, group }) => {
    const [first, second] = group.dishes;
    const done = await joinAsGuest(request, group.groupId, 'Done');
    const late = await joinAsGuest(request, group.groupId, 'Late');
    await addDish(request, done, first.id, 1);
    await addDish(request, late, second.id, 4);
    await submitGuestCart(request, done);

    const res = await submitGroup(request, group.groupId, group.reservationId, group.owner.idToken);
    expect(res.status()).toBe(200);
    const merged = await parse<{ dishId: string; quantity: number }[]>(res);

    expect(merged).toEqual([{ dishId: first.id, quantity: 1 }]);
  });

  test('after confirmation a guest who has not submitted cannot add dishes any more (409)', async ({ request, group }) => {
    const done = await joinAsGuest(request, group.groupId, 'Andrii');
    const late = await joinAsGuest(request, group.groupId, 'Late');
    await addDish(request, done, group.dishes[0].id, 1);
    await submitGuestCart(request, done);
    expect((await submitGroup(request, group.groupId, group.reservationId, group.owner.idToken)).status()).toBe(200);

    const res = await addDish(request, late, group.dishes[1].id, 1);
    expect(res.status()).toBe(409);
  });

  test.describe('negative', () => {
    test('nobody has submitted yet: 400', async ({ request, group }) => {
      const guest = await joinAsGuest(request, group.groupId, 'Thinking');
      await addDish(request, guest, group.dishes[0].id, 1);

      const res = await submitGroup(request, group.groupId, group.reservationId, group.owner.idToken);
      expect(res.status()).toBe(400);
    });

    test('submitted carts are empty: 400', async ({ request, group }) => {
      const guest = await joinAsGuest(request, group.groupId, 'No Dishes');
      await submitGuestCart(request, guest);

      const res = await submitGroup(request, group.groupId, group.reservationId, group.owner.idToken);
      expect(res.status()).toBe(400);
    });

    test('second confirmation of the same group is rejected with 400 (chosen behaviour)', async ({ request, group }) => {
      const guest = await joinAsGuest(request, group.groupId, 'Andrii');
      await addDish(request, guest, group.dishes[0].id, 1);
      await submitGuestCart(request, guest);

      expect((await submitGroup(request, group.groupId, group.reservationId, group.owner.idToken)).status()).toBe(200);
      const again = await submitGroup(request, group.groupId, group.reservationId, group.owner.idToken);
      expect(again.status()).toBe(400);
    });

    test('request without token: 401', async ({ request, group }) => {
      const res = await submitGroup(request, group.groupId, group.reservationId);
      expect(res.status()).toBe(401);
    });

    test('another customer (not the owner): 403', async ({ request, group }) => {
      const stranger = await getOwner(request);
      const res = await submitGroup(request, group.groupId, group.reservationId, stranger.idToken);
      expect(res.status()).toBe(403);
    });

    test('reservationId from another group: 400', async ({ request, group }) => {
      const res = await submitGroup(request, group.groupId, 'some-other-reservation', group.owner.idToken);
      expect([400, 404]).toContain(res.status());
    });

    test('unknown group id: 404', async ({ request, group }) => {
      const res = await submitGroup(request, 'does-not-exist-123', group.reservationId, group.owner.idToken);
      expect(res.status()).toBe(404);
    });
  });
});
