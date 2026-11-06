/**
 * The form in which an email is stored and looked up: trimmed and lower-cased. `users.email` is
 * `citext`, so the database matches without regard to case as well; normalising first keeps stored
 * values uniform and makes the lookup independent of the column type.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
