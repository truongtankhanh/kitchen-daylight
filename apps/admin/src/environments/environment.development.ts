// `ng serve` proxies /api and /socket.io to the API on 127.0.0.1:3001 (proxy.conf.json).
export const environment = {
  apiBaseUrl: '/api',
} as const;
