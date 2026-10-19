export function parseIPv4(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) throw new Error(`invalid IPv4 address: ${ip}`);
  let n = 0;
  for (const part of parts) {
    if (part === "" || !/^\d{1,3}$/.test(part)) throw new Error(`invalid IPv4 address: ${ip}`);
    const v = Number(part);
    if (v > 255) throw new Error(`invalid IPv4 address: ${ip}`);
    n = ((n << 8) | v) >>> 0;
  }
  return n >>> 0;
}

export function ipv4ToString(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function maskFor(prefixLen: number): number {
  if (prefixLen <= 0) return 0;
  if (prefixLen >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefixLen)) >>> 0;
}

export function inSubnet(ip: string, target: string): boolean {
  if (target === "any") return true;
  const [base, lenText] = target.split("/");
  const prefixLen = lenText === undefined ? 32 : Number(lenText);
  if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) {
    throw new Error(`invalid subnet: ${target}`);
  }
  const mask = maskFor(prefixLen);
  return ((parseIPv4(ip) & mask) >>> 0) === ((parseIPv4(base) & mask) >>> 0);
}

export function isPrivateIPv4(ip: string): boolean {
  return inSubnet(ip, "10.0.0.0/8") || inSubnet(ip, "172.16.0.0/12") || inSubnet(ip, "192.168.0.0/16");
}

export const DOCUMENTATION_RANGES = ["192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24"] as const;

export function isDocumentationIPv4(ip: string): boolean {
  return DOCUMENTATION_RANGES.some((range) => inSubnet(ip, range));
}

export function prefixLengthOf(cidr: string): number {
  const [, lenText] = cidr.split("/");
  if (lenText === undefined) return 32;
  const prefixLen = Number(lenText);
  if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) {
    throw new Error(`invalid subnet: ${cidr}`);
  }
  return prefixLen;
}

export function networkOf(ip: string, prefixLen: number): string {
  const mask = maskFor(prefixLen);
  return ipv4ToString((parseIPv4(ip) & mask) >>> 0);
}

export function cidrOf(ip: string, prefixLen: number): string {
  return `${networkOf(ip, prefixLen)}/${prefixLen}`;
}
