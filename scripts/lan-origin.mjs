import { networkInterfaces } from 'node:os';

/** Prefer the Wi-Fi/LAN IPv4 so phones on the same network can reach us. */
export function lanIPv4() {
  const scored = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      const family = addr.family === 4 || addr.family === 'IPv4';
      if (!family || addr.internal) continue;
      if (addr.address.startsWith('169.254.')) continue;
      scored.push({ name, address: addr.address, score: scoreInterface(name, addr.address) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.address ?? null;
}

function scoreInterface(name, ip) {
  let score = 0;
  if (ip.startsWith('192.168.')) score += 30;
  else if (ip.startsWith('10.')) score += 20;
  else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) score += 15;
  if (name === 'en0' || /^en\d+$/.test(name) || name.startsWith('wlan') || name.startsWith('wi-fi') || name.startsWith('Wi-Fi')) {
    score += 10;
  }
  if (name.startsWith('utun') || name.startsWith('tun') || name.includes('vpn') || name.startsWith('awdl')) {
    score -= 20;
  }
  return score;
}

export function defaultLanOrigin(port = 8787) {
  const ip = lanIPv4();
  return ip === null ? `http://127.0.0.1:${port}` : `http://${ip}:${port}`;
}
