/**
 * Separators a person types inside a phone number: whitespace, hyphens and dots
 * (`090 123 4567`, `090-123-4567`, `090.123.4567`). Removed before matching; nothing else is.
 */
const SEPARATORS = /[\s.-]/gu;

/**
 * A Vietnamese mobile number after the separators are removed (api-divergences D-045; the outline
 * names the rule, mobile G97, but gives no pattern): the national form `0` + 9 digits, or the
 * international form `+84` or `84` + 9 digits, where the 9 subscriber digits start with a mobile
 * prefix `3`, `5`, `7`, `8` or `9` (national `03`, `05`, `07`, `08`, `09`). Landlines (`02…`), the
 * trunk zero after the country code (`+840…`), `0084` and any other length are refused.
 */
export const VIETNAM_MOBILE_PATTERN = /^(?:\+84|84|0)([35789]\d{8})$/u;

/** Longest input looked at; a longer string is refused without running the pattern. */
export const VIETNAM_PHONE_INPUT_MAX_LENGTH = 32;

/**
 * The E.164 form (`+84` + 9 digits) of a Vietnamese mobile number in national or international
 * form, or `null` when the input is not one (the caller answers `VALIDATION_FAILED` with
 * `INVALID_PHONE`, api-outline Conventions "Phone numbers"). Shared by registration (A2-T1),
 * `PATCH /me` (A2-T4) and the order phone (A2-T5). Never logs or echoes the input.
 */
export function normalizeVietnamMobile(input: string): string | null {
  if (input.length > VIETNAM_PHONE_INPUT_MAX_LENGTH) {
    return null;
  }
  const match = VIETNAM_MOBILE_PATTERN.exec(input.replace(SEPARATORS, ''));
  const subscriber = match?.[1];
  return subscriber === undefined ? null : `+84${subscriber}`;
}
