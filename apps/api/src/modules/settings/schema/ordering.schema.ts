// class-transformer's `@Type` reads Reflect metadata when the class is defined. Load the polyfill
// here, not through Nest, because the schema specs import this file without Nest (as
// config/config.schema.ts does).
import 'reflect-metadata';

import { Type } from 'class-transformer';
import { IsDefined, IsInt, Max, Min, ValidateIf, ValidateNested } from 'class-validator';

import { defineSettingSchema, ExceedsAcceptLate, IsLessThanProperty } from './setting-rules.js';

// `ordering` (data-model `app_settings`; brief L3, L4, L8, A34, A42; mobile G32, G33, G70; WA16).

/** The `CHECK` of 99 on `order_items.quantity`: the hard limit of `maxItemQuantity` (brief L3). */
export const ORDER_ITEM_QUANTITY_HARD_MAX = 99;
/** The `CHECK` on `order_items.note`: `itemNoteMax` never exceeds it (mobile G32). */
export const ORDER_ITEM_NOTE_HARD_MAX = 200;

/**
 * Bounds the documents do not state, chosen wide enough for any real value (api-divergences
 * D-105). Thresholds are minutes; the refetch interval is seconds.
 */
export const ORDERING_BOUNDS = {
  maxCartLines: { min: 1, max: 100 },
  scheduleMinLeadMinutes: { min: 0, max: 1440 },
  scheduleMaxDaysAhead: { min: 0, max: 30 },
  reviewWindowDays: { min: 1, max: 90 },
  autoCancelUnacceptedMinutes: { min: 1, max: 1440 },
  thresholdMinutes: { min: 1, max: 240 },
  boardRefetchSeconds: { min: 5, max: 300 },
  callHintMinutes: { min: 1, max: 240 },
  listMaxRangeDays: { min: 1, max: 366 },
} as const;

const { thresholdMinutes } = ORDERING_BOUNDS;

export interface ThresholdPair {
  readonly warn: number;
  readonly late: number;
}

export interface BoardThresholds {
  /** From placed until accepted. */
  readonly accept: ThresholdPair;
  /** From preparing until ready (brief L4). */
  readonly ready: ThresholdPair;
}

export interface OrderingSetting {
  readonly maxItemQuantity: number;
  readonly maxCartLines: number;
  readonly itemNoteMax: number;
  readonly scheduleMinLeadMinutes: number;
  readonly scheduleMaxDaysAhead: number;
  readonly reviewWindowDays: number;
  /** `null`: auto-cancel of unaccepted orders is off (WA16). */
  readonly autoCancelUnacceptedMinutes: number | null;
  readonly boardThresholds: BoardThresholds;
  readonly boardRefetchSeconds: number;
  readonly readyUnservedWarnMinutes: number;
  readonly readyUnservedLateMinutes: number;
  readonly callHintMinutes: number;
  readonly listMaxRangeDays: number;
}

/** `app_settings.value` of key `ordering`, data-model names. */
export interface OrderingStored {
  readonly max_item_quantity: number;
  readonly max_cart_lines: number;
  readonly item_note_max: number;
  readonly schedule_min_lead_minutes: number;
  readonly schedule_max_days_ahead: number;
  readonly review_window_days: number;
  readonly auto_cancel_unaccepted_minutes: number | null;
  readonly board_thresholds: {
    readonly accept: ThresholdPair;
    readonly ready: ThresholdPair;
  };
  readonly board_refetch_seconds: number;
  readonly ready_unserved_warn_minutes: number;
  readonly ready_unserved_late_minutes: number;
  readonly call_hint_minutes: number;
  readonly list_max_range_days: number;
}

export class ThresholdPairDto implements ThresholdPair {
  @IsDefined()
  @IsInt()
  @Min(thresholdMinutes.min)
  @Max(thresholdMinutes.max)
  @IsLessThanProperty('late')
  warn!: number;

  @IsDefined()
  @IsInt()
  @Min(thresholdMinutes.min)
  @Max(thresholdMinutes.max)
  late!: number;
}

export class BoardThresholdsDto implements BoardThresholds {
  @IsDefined()
  @ValidateNested()
  @Type(() => ThresholdPairDto)
  accept!: ThresholdPairDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => ThresholdPairDto)
  ready!: ThresholdPairDto;
}

export class OrderingSettingDto implements OrderingSetting {
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(ORDER_ITEM_QUANTITY_HARD_MAX)
  maxItemQuantity!: number;

  @IsDefined()
  @IsInt()
  @Min(ORDERING_BOUNDS.maxCartLines.min)
  @Max(ORDERING_BOUNDS.maxCartLines.max)
  maxCartLines!: number;

  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(ORDER_ITEM_NOTE_HARD_MAX)
  itemNoteMax!: number;

  @IsDefined()
  @IsInt()
  @Min(ORDERING_BOUNDS.scheduleMinLeadMinutes.min)
  @Max(ORDERING_BOUNDS.scheduleMinLeadMinutes.max)
  scheduleMinLeadMinutes!: number;

  @IsDefined()
  @IsInt()
  @Min(ORDERING_BOUNDS.scheduleMaxDaysAhead.min)
  @Max(ORDERING_BOUNDS.scheduleMaxDaysAhead.max)
  scheduleMaxDaysAhead!: number;

  @IsDefined()
  @IsInt()
  @Min(ORDERING_BOUNDS.reviewWindowDays.min)
  @Max(ORDERING_BOUNDS.reviewWindowDays.max)
  reviewWindowDays!: number;

  /** Present; `null` turns it off. When set, above `boardThresholds.accept.late` (brief L8). */
  @ValidateIf((dto: OrderingSettingDto) => dto.autoCancelUnacceptedMinutes !== null)
  @IsDefined()
  @IsInt()
  @Min(ORDERING_BOUNDS.autoCancelUnacceptedMinutes.min)
  @Max(ORDERING_BOUNDS.autoCancelUnacceptedMinutes.max)
  @ExceedsAcceptLate((dto) => (dto as Partial<OrderingSettingDto>).boardThresholds?.accept?.late)
  autoCancelUnacceptedMinutes!: number | null;

  @IsDefined()
  @ValidateNested()
  @Type(() => BoardThresholdsDto)
  boardThresholds!: BoardThresholdsDto;

  @IsDefined()
  @IsInt()
  @Min(ORDERING_BOUNDS.boardRefetchSeconds.min)
  @Max(ORDERING_BOUNDS.boardRefetchSeconds.max)
  boardRefetchSeconds!: number;

  @IsDefined()
  @IsInt()
  @Min(thresholdMinutes.min)
  @Max(thresholdMinutes.max)
  @IsLessThanProperty('readyUnservedLateMinutes')
  readyUnservedWarnMinutes!: number;

  @IsDefined()
  @IsInt()
  @Min(thresholdMinutes.min)
  @Max(thresholdMinutes.max)
  readyUnservedLateMinutes!: number;

  @IsDefined()
  @IsInt()
  @Min(ORDERING_BOUNDS.callHintMinutes.min)
  @Max(ORDERING_BOUNDS.callHintMinutes.max)
  callHintMinutes!: number;

  @IsDefined()
  @IsInt()
  @Min(ORDERING_BOUNDS.listMaxRangeDays.min)
  @Max(ORDERING_BOUNDS.listMaxRangeDays.max)
  listMaxRangeDays!: number;
}

function pair({ warn, late }: ThresholdPair): ThresholdPair {
  return { warn, late };
}

export function toOrderingStored(value: OrderingSetting): OrderingStored {
  return {
    max_item_quantity: value.maxItemQuantity,
    max_cart_lines: value.maxCartLines,
    item_note_max: value.itemNoteMax,
    schedule_min_lead_minutes: value.scheduleMinLeadMinutes,
    schedule_max_days_ahead: value.scheduleMaxDaysAhead,
    review_window_days: value.reviewWindowDays,
    auto_cancel_unaccepted_minutes: value.autoCancelUnacceptedMinutes,
    board_thresholds: {
      accept: pair(value.boardThresholds.accept),
      ready: pair(value.boardThresholds.ready),
    },
    board_refetch_seconds: value.boardRefetchSeconds,
    ready_unserved_warn_minutes: value.readyUnservedWarnMinutes,
    ready_unserved_late_minutes: value.readyUnservedLateMinutes,
    call_hint_minutes: value.callHintMinutes,
    list_max_range_days: value.listMaxRangeDays,
  };
}

export function fromOrderingStored(stored: OrderingStored): OrderingSetting {
  return {
    maxItemQuantity: stored.max_item_quantity,
    maxCartLines: stored.max_cart_lines,
    itemNoteMax: stored.item_note_max,
    scheduleMinLeadMinutes: stored.schedule_min_lead_minutes,
    scheduleMaxDaysAhead: stored.schedule_max_days_ahead,
    reviewWindowDays: stored.review_window_days,
    autoCancelUnacceptedMinutes: stored.auto_cancel_unaccepted_minutes,
    boardThresholds: {
      accept: pair(stored.board_thresholds.accept),
      ready: pair(stored.board_thresholds.ready),
    },
    boardRefetchSeconds: stored.board_refetch_seconds,
    readyUnservedWarnMinutes: stored.ready_unserved_warn_minutes,
    readyUnservedLateMinutes: stored.ready_unserved_late_minutes,
    callHintMinutes: stored.call_hint_minutes,
    listMaxRangeDays: stored.list_max_range_days,
  };
}

export const orderingSchema = defineSettingSchema<'ordering', OrderingSetting, OrderingStored>({
  key: 'ordering',
  storageKey: 'ordering',
  dto: OrderingSettingDto,
  toStored: toOrderingStored,
  fromStored: fromOrderingStored,
});
