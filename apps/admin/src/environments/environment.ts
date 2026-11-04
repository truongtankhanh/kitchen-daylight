// Same-origin API: Caddy routes /api to the API in every tier (decision 0005, section 1).
export const environment = {
  apiBaseUrl: '/api',
} as const;
