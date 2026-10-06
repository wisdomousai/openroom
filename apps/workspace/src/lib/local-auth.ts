/** Loopback control plane — `bun desktop` and `bun dev`. */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/** RFC1918 / link-local IPv4 — LAN `bun desktop` so phones can join. */
export function isPrivateIpv4(hostname: string): boolean {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

/** Desktop pointed at a local worker uses demo accounts, not Google. */
export function useDevLoginOnly(hostname: string, desktop: boolean): boolean {
  return desktop && (isLoopbackHost(hostname) || isPrivateIpv4(hostname));
}
