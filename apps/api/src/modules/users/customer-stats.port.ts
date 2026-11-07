import { Injectable } from '@nestjs/common';

// Decision 0005, section 6: a port is an interface plus an injection token in its owning module.

/** Injection token of the bound `CustomerStatsPort`. */
export const CUSTOMER_STATS_PORT = Symbol('CUSTOMER_STATS_PORT');

/**
 * The derived figures of a customer in `GET /admin/users` (data-model "Derived on read"; brief E12,
 * M19). Never stored on `users`.
 */
export interface CustomerStats {
  readonly ordersCount: number;
  readonly lastOrderAt: Date | null;
  readonly completedOrders: number;
  /** Loyalty points, an integer. */
  readonly pointsBalance: number;
}

export interface CustomerStatsPort {
  /** The figures of each id; an id with no orders or points may be absent from the map. */
  statsFor(userIds: readonly string[]): Promise<ReadonlyMap<string, CustomerStats>>;
}

/** The figures of a customer with no orders and no points. */
export const EMPTY_CUSTOMER_STATS: CustomerStats = Object.freeze({
  ordersCount: 0,
  lastOrderAt: null,
  completedOrders: 0,
  pointsBalance: 0,
});

/**
 * The binding until the order and loyalty tables exist (A3-T4). It is exact today, not a fake:
 * no order or points row can exist before those slices. **A8 (orders) and A15 (loyalty) must bind
 * a real implementation** that reads `orders` and the points ledger, grouped per customer in one
 * query per page.
 */
@Injectable()
export class NoOrdersCustomerStats implements CustomerStatsPort {
  statsFor(): Promise<ReadonlyMap<string, CustomerStats>> {
    return Promise.resolve(new Map());
  }
}
