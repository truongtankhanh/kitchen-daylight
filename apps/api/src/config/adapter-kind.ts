// Decision 0005, section 5: every adapter declares one of three kinds, which the production guard
// checks against `APP_ENV` before Nest boots.

/**
 * - `real`: a provider in the cloud (SES, AWS S3, Amazon Location).
 * - `emulator`: a local stand-in reached over the network (SMTP to Mailpit, S3 with an endpoint
 *   override).
 * - `fixture`: canned answers in process.
 */
export const ADAPTER_KINDS = ['real', 'emulator', 'fixture'] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

/** Implemented by every adapter class, so a unit test can compare it with its module's kind table. */
export interface DeclaresAdapterKind {
  readonly kind: AdapterKind;
}
