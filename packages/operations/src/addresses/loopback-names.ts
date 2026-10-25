import { canonicalHostOf, ipv4Block, ipv4InTheLowBitsOf, ipv4Of, ipv6Block, ipv6Of } from './canonical-hosts.ts';

export const loopbackNames: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

const isInTheIpv4Loopback = ipv4Block('127.0.0.0', 8);

const isTheIpv6Loopback = ipv6Block('[::1]', 128);

const isMappedFromIpv4 = ipv6Block('[::ffff:0:0]', 96);

function namesTheLoopbackByName(canonical: string): boolean {
  return canonical === 'localhost' || canonical.endsWith('.localhost');
}

function isLoopbackIpv6(address: bigint): boolean {
  return isTheIpv6Loopback(address) || (isMappedFromIpv4(address) && isInTheIpv4Loopback(ipv4InTheLowBitsOf(address)));
}

export function namesTheLoopback(hostname: string): boolean {
  const canonical = canonicalHostOf(hostname);
  if (canonical === undefined) {
    return false;
  }
  const ipv4 = ipv4Of(canonical);
  const ipv6 = ipv6Of(canonical);
  if (ipv4 !== undefined) {
    return isInTheIpv4Loopback(ipv4);
  }
  return ipv6 === undefined ? namesTheLoopbackByName(canonical) : isLoopbackIpv6(ipv6);
}
