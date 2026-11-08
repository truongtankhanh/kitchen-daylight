import { Inject, Injectable } from '@nestjs/common';

import type { SettingValues } from './schema/registry.js';
import { SettingsService } from './settings.service.js';

// `GET /meta/config` (api-outline Public table; brief L12, L13; mobile G32, G33, G49, G70, G134).

export interface PublicConfigView {
  readonly brand: {
    readonly name: string;
    /** The URL of the uploaded `brand.logo`; `null` until media URLs exist (A6). */
    readonly logoUrl: string | null;
    readonly hotline: string | null;
  };
  readonly minAppVersion: SettingValues['minAppVersion'];
  readonly maintenance: SettingValues['maintenance'];
  readonly featureFlags: {
    readonly ordering: boolean;
    readonly delivery: boolean;
    readonly reservations: boolean;
    readonly loyalty: boolean;
  };
  readonly ordering: {
    readonly maxItemQuantity: number;
    readonly maxCartLines: number;
    readonly itemNoteMax: number;
    readonly scheduleMinLeadMinutes: number;
    readonly scheduleMaxDaysAhead: number;
    readonly callHintMinutes: number;
    readonly reviewWindowDays: number;
  };
  /** Whether the app may offer bank transfer; never the details (brief A13; mobile G49). */
  readonly payment: { readonly bankTransferEnabled: boolean };
  readonly loyalty: SettingValues['loyalty'];
  readonly cdnBaseUrl: string | null;
  readonly mapStyleUrl: string | null;
  readonly attributions: string[];
}

export interface PublicConfigInput {
  readonly brand: SettingValues['brand'];
  readonly minAppVersion: SettingValues['minAppVersion'];
  readonly maintenance: SettingValues['maintenance'];
  readonly featureFlags: SettingValues['featureFlags'];
  readonly ordering: SettingValues['ordering'];
  readonly payment: SettingValues['payment'];
  readonly loyalty: SettingValues['loyalty'];
}

function isFilled(value: string | null): boolean {
  return value !== null && value.trim() !== '';
}

/**
 * Bank transfer is offered when the bank name, account number and account holder are all filled
 * (data-model `app_settings.payment`, proposal; mobile G49). The bank code and QR are optional.
 */
export function isBankTransferComplete(payment: SettingValues['payment']): boolean {
  return (
    isFilled(payment.bankName) && isFilled(payment.accountNumber) && isFilled(payment.accountHolder)
  );
}

/**
 * The public config from the settings values, field by field, so a new setting never reaches the
 * public answer by accident. No bank detail, no tax code, no editor, no admin-only key.
 */
export function buildPublicConfig(input: PublicConfigInput): PublicConfigView {
  const { brand, featureFlags, ordering } = input;
  return {
    brand: { name: brand.name, logoUrl: null, hotline: brand.hotline },
    minAppVersion: { ios: input.minAppVersion.ios, android: input.minAppVersion.android },
    maintenance: { ...input.maintenance },
    featureFlags: {
      ordering: featureFlags.ordering,
      delivery: featureFlags.delivery,
      reservations: featureFlags.reservations,
      loyalty: featureFlags.loyalty,
    },
    ordering: {
      maxItemQuantity: ordering.maxItemQuantity,
      maxCartLines: ordering.maxCartLines,
      itemNoteMax: ordering.itemNoteMax,
      scheduleMinLeadMinutes: ordering.scheduleMinLeadMinutes,
      scheduleMaxDaysAhead: ordering.scheduleMaxDaysAhead,
      callHintMinutes: ordering.callHintMinutes,
      reviewWindowDays: ordering.reviewWindowDays,
    },
    payment: { bankTransferEnabled: isBankTransferComplete(input.payment) },
    loyalty: { ...input.loyalty },
    // The CDN rule is decision 0009 (A6-T1) and the map tile source an open owner item (ADR-0008
    // open item 1): no value until they are decided.
    cdnBaseUrl: null,
    mapStyleUrl: null,
    attributions: [],
  };
}

/** Reads the settings the public config is built from: one primary-key read per key. */
@Injectable()
export class PublicConfigService {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  async read(): Promise<PublicConfigView> {
    return buildPublicConfig({
      brand: await this.settings.getValue('brand'),
      minAppVersion: await this.settings.getValue('minAppVersion'),
      maintenance: await this.settings.getValue('maintenance'),
      featureFlags: await this.settings.getValue('featureFlags'),
      ordering: await this.settings.getValue('ordering'),
      payment: await this.settings.getValue('payment'),
      loyalty: await this.settings.getValue('loyalty'),
    });
  }
}
