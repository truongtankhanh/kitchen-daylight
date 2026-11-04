// Realtime event types (decision 0004 section 6).
// - The event names and payloads belong to the realtime slice; none is defined here yet.
// - The API gateway and both clients import them only from `@kd/contracts` and never redeclare
//   them locally.
// - This file imports nothing from `src/generated/**` or `src/client.ts`.

/** Map of realtime event name to payload type. Empty until the realtime slice adds its events. */
export type RealtimeEventMap = Record<never, never>;
