// Expo app config, one variant per build profile (decision 0006 item 9).
// Every value here ships in plain text inside the app: never put a secret in this file,
// in `extra` or in an `EXPO_PUBLIC_*` variable.
import type { ConfigContext, ExpoConfig } from 'expo/config';

type Variant = 'dev' | 'demo' | 'prod';

interface VariantConfig {
  readonly name: string;
  readonly scheme: string;
  readonly bundleIdentifier: string;
  /** Read at runtime through `expo-constants` (`extra.apiBaseUrl`). */
  readonly apiBaseUrl: string | undefined;
}

// TODO(WA1): placeholders until the restaurant name, the domain and the store accounts exist.
// Replacing them is one edit of this block, done by the release slice.
const BASE_IDENTIFIER = 'com.example.kitchendaylight';
const DISPLAY_NAME = 'KD';
const SLUG = 'kd';
const VARIANTS: Readonly<Record<Variant, VariantConfig>> = {
  dev: {
    name: `${DISPLAY_NAME} Dev`,
    scheme: 'kd-dev',
    bundleIdentifier: `${BASE_IDENTIFIER}.dev`,
    // The developer machine's LAN URL, from apps/mobile/.env.local (git-ignored).
    apiBaseUrl: process.env.KD_MOBILE_DEV_API_URL,
  },
  demo: {
    name: `${DISPLAY_NAME} Demo`,
    scheme: 'kd-demo',
    bundleIdentifier: `${BASE_IDENTIFIER}.demo`,
    apiBaseUrl: 'https://demo.example.invalid/api',
  },
  prod: {
    name: DISPLAY_NAME,
    scheme: 'kd',
    bundleIdentifier: BASE_IDENTIFIER,
    apiBaseUrl: 'https://example.invalid/api',
  },
};

function isVariant(value: string): value is Variant {
  return Object.hasOwn(VARIANTS, value);
}

function readVariant(): Variant {
  const value = process.env.APP_VARIANT ?? 'dev';
  if (!isVariant(value)) {
    throw new Error(
      `APP_VARIANT must be one of ${Object.keys(VARIANTS).join(', ')}, got "${value}"`,
    );
  }
  return value;
}

function readApiBaseUrl(variant: Variant, raw: string | undefined): string {
  if (!raw) {
    throw new Error(
      variant === 'dev'
        ? 'KD_MOBILE_DEV_API_URL is not set (apps/mobile/.env.local)'
        : `No API base URL for APP_VARIANT=${variant}`,
    );
  }
  const url = new URL(raw);
  if (variant !== 'dev' && url.protocol !== 'https:') {
    throw new Error(`The API base URL for APP_VARIANT=${variant} must use https://`);
  }
  // The OpenAPI paths start with /api; the client strips this suffix (`toClientBaseUrl`).
  if (!/\/api\/?$/.test(url.pathname)) {
    throw new Error(`The API base URL for APP_VARIANT=${variant} must end with /api`);
  }
  return raw;
}

/** A store build can never ship a placeholder identifier or domain. */
function assertNoPlaceholder(variant: Variant, apiBaseUrl: string): void {
  if (variant !== 'prod') {
    return;
  }
  if (
    BASE_IDENTIFIER.startsWith('com.example.') ||
    new URL(apiBaseUrl).hostname.endsWith('.invalid')
  ) {
    throw new Error('APP_VARIANT=prod still uses placeholder identifiers or URLs (TODO(WA1))');
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = readVariant();
  const selected = VARIANTS[variant];
  const apiBaseUrl = readApiBaseUrl(variant, selected.apiBaseUrl);
  assertNoPlaceholder(variant, apiBaseUrl);

  return {
    ...config,
    name: selected.name,
    slug: SLUG,
    scheme: selected.scheme,
    version: '0.0.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    ios: { bundleIdentifier: selected.bundleIdentifier },
    android: { package: selected.bundleIdentifier },
    plugins: ['expo-router'],
    extra: { apiBaseUrl },
  };
};
