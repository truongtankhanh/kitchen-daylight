// Shared check of the two staff link templates (`STAFF_INVITE`, `STAFF_PASSWORD_RESET`; A3-T3).

/**
 * Whether `link` is an absolute `http(s)` URL that carries the token in its fragment
 * (`…#token=<value>`, decision 0008 section 6). The template refuses anything else, so a link with
 * the token in the query string can never be mailed by mistake.
 */
export function isStaffLink(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.search === '' &&
    /^#token=[A-Za-z0-9_-]+$/u.test(url.hash)
  );
}
