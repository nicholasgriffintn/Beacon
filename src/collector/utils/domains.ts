export function getHostnameFromUrl(url: string | undefined | null): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isValidBaseDomain(domain: string): boolean {
  if (domain === "localhost" || /^localhost:\d+$/.test(domain)) {
    return true;
  }

  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain);
}

export function isValidSiteDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("*.")) {
    return isValidBaseDomain(normalized.slice(2));
  }

  return isValidBaseDomain(normalized);
}

export function isHostnameAllowed(allowedDomain: string, hostname: string): boolean {
  const allowed = allowedDomain.trim().toLowerCase();
  const requestHostname = hostname.toLowerCase();

  if (allowed === requestHostname) {
    return true;
  }

  if (allowed.startsWith("*.")) {
    const baseDomain = allowed.slice(2);
    return requestHostname === baseDomain || requestHostname.endsWith(`.${baseDomain}`);
  }

  return false;
}

export function getPathFromUrl(url: string | undefined | null): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

export function getOriginFromHeaders(headers: Headers): string | null {
  return headers.get("origin") || headers.get("referer");
}
