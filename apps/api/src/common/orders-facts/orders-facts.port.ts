import { Injectable, Module } from '@nestjs/common';
import type { DynamicModule, Type } from '@nestjs/common';

// Decision 0005, section 6: a port is an interface plus an injection token. This one lives in
// `common/` because its readers (branches, menu) must not import the orders slice, and the orders
// slice does not exist yet. No orders code is imported here.

/** Injection token of the bound `OrdersFacts`. */
export const ORDERS_FACTS = Symbol('ORDERS_FACTS');

/** Work still open at a branch: orders in progress and upcoming reservations. */
export interface BranchActiveWork {
  readonly orders: number;
  readonly reservations: number;
}

/** The figures of one branch for the branch list (brief C2). */
export interface BranchTodayStats {
  /** Orders placed today (business day, `Asia/Ho_Chi_Minh`). */
  readonly ordersToday: number;
  /** Orders not yet in a final state. */
  readonly activeOrders: number;
}

/**
 * Facts about orders and reservations that other slices read without importing them. Every
 * method is a read; none writes.
 */
export interface OrdersFacts {
  /** True once any order of the branch exists, whatever its state: the branch `code` locks (C6). */
  branchHasAnyOrder(branchId: string): Promise<boolean>;
  /** What refuses a branch delete with `HAS_ACTIVE_ORDERS` (brief C1). */
  branchActiveWork(branchId: string): Promise<BranchActiveWork>;
  /** The figures of each id; an id with no order may be absent from the map. */
  branchTodayStats(branchIds: readonly string[]): Promise<ReadonlyMap<string, BranchTodayStats>>;
  /** Orders that reference the delivery zone, so it cannot be deleted (`IN_USE`, brief C22). */
  zoneUsage(zoneId: string): Promise<number>;
  /** Orders in progress at the given branches that contain the menu item. */
  menuItemActiveOrders(menuItemId: string, branchIds: readonly string[]): Promise<number>;
  /** The `order_number` of each id; an unknown id is absent from the map. */
  orderNumbers(orderIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/** The work of a branch with no order and no reservation. */
export const NO_ACTIVE_WORK: BranchActiveWork = Object.freeze({ orders: 0, reservations: 0 });

/** The figures of a branch with no order today. */
export const EMPTY_TODAY_STATS: BranchTodayStats = Object.freeze({
  ordersToday: 0,
  activeOrders: 0,
});

/**
 * The binding until the order and reservation tables exist (A5-T2). It is exact today, not a
 * fake: no order or reservation row can exist before those slices. **A8-T8 must bind an
 * implementation that reads `orders`** (every method) **and A14 must add the reservation count**
 * of `branchActiveWork`.
 */
@Injectable()
export class NoOrdersFacts implements OrdersFacts {
  branchHasAnyOrder(): Promise<boolean> {
    return Promise.resolve(false);
  }

  branchActiveWork(): Promise<BranchActiveWork> {
    return Promise.resolve(NO_ACTIVE_WORK);
  }

  branchTodayStats(): Promise<ReadonlyMap<string, BranchTodayStats>> {
    return Promise.resolve(new Map());
  }

  zoneUsage(): Promise<number> {
    return Promise.resolve(0);
  }

  menuItemActiveOrders(): Promise<number> {
    return Promise.resolve(0);
  }

  orderNumbers(): Promise<ReadonlyMap<string, string>> {
    return Promise.resolve(new Map());
  }
}

/**
 * Binds `ORDERS_FACTS` once for the whole app (global), so a feature module injects the token
 * without importing a module of the orders slice. `AppModule` picks the implementation:
 * `OrdersFactsModule.forRoot(NoOrdersFacts)` until A8-T8.
 */
@Module({})
export class OrdersFactsModule {
  static forRoot(implementation: Type<OrdersFacts>): DynamicModule {
    return {
      module: OrdersFactsModule,
      global: true,
      providers: [{ provide: ORDERS_FACTS, useClass: implementation }],
      exports: [ORDERS_FACTS],
    };
  }
}
