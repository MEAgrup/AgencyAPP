/**
 * Parses the GoTrue recovery-flow URL fragment
 * (`#access_token=...&type=recovery&...`) into the access token, or `null`
 * when absent/malformed. Pure and framework-free so it is unit-testable
 * without mounting the reset-password page — see
 * src/app/reset-password/page.tsx, which calls this with
 * `window.location.hash`.
 */
export function parseAccessTokenFromHash(hash: string): string | null {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  const token = params.get('access_token');
  return token && token !== '' ? token : null;
}
