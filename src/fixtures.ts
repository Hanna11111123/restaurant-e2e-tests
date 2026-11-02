import { test as base, expect } from '@playwright/test';
import {
  Dish, Owner, cancelReservation, createOrder, createReservation, getDishes, getGroupReservationId,
  getOwner, pickLocationId,
} from './api';

export interface GroupPreOrder {
  owner: Owner;
  reservationId: string;
  groupId: string;
  dishes: Dish[];
}

/**
 * Every test gets its own owner, reservation and group, so tests do not share state
 * and can run in parallel. The reservation is cancelled after the test.
 */
export const test = base.extend<{ group: GroupPreOrder }>({
  group: async ({ request }, use) => {
    const owner = await getOwner(request);
    const locationId = await pickLocationId(request);
    const dishes = await getDishes(request, locationId, 2);
    const reservation = await createReservation(request, owner, locationId);
    await createOrder(request, owner, reservation.id, dishes);
    const groupId = await getGroupReservationId(request, owner, reservation.id);

    await use({ owner, reservationId: reservation.id, groupId, dishes });

    await cancelReservation(request, owner, reservation.id);
  },
});

export { expect };
