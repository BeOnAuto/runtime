import { canonicalHostOf, ipv4Block, ipv4InTheLowBitsOf, ipv4Of, ipv6Block, ipv6Of } from './canonical-hosts.ts';

const privateIpv4Blocks: readonly ((address: number) => boolean)[] = [
  ipv4Block('0.0.0.0', 8),
  ipv4Block('10.0.0.0', 8),
  ipv4Block('100.64.0.0', 10),
  ipv4Block('127.0.0.0', 8),
  ipv4Block('169.254.0.0', 16),
  ipv4Block('172.16.0.0', 12),
  ipv4Block('192.0.0.0', 24),
  ipv4Block('192.0.2.0', 24),
  ipv4Block('192.88.99.0', 24),
  ipv4Block('192.168.0.0', 16),
  ipv4Block('198.18.0.0', 15),
  ipv4Block('198.51.100.0', 24),
  ipv4Block('203.0.113.0', 24),
  ipv4Block('224.0.0.0', 4),
  ipv4Block('240.0.0.0', 4),
];

const privateIpv6Blocks: readonly ((address: bigint) => boolean)[] = [
  ipv6Block('[::]', 96),
  ipv6Block('[64:ff9b:1::]', 48),
  ipv6Block('[100::]', 64),
  ipv6Block('[2001::]', 23),
  ipv6Block('[2001:db8::]', 32),
  ipv6Block('[fc00::]', 7),
  ipv6Block('[fe80::]', 10),
  ipv6Block('[fec0::]', 10),
  ipv6Block('[ff00::]', 8),
];

const ipv6BlocksHoldingIpv4: readonly ((address: bigint) => boolean)[] = [
  ipv6Block('[::ffff:0:0]', 96),
  ipv6Block('[::ffff:0:0:0]', 96),
  ipv6Block('[64:ff9b::]', 96),
];

const isSixToFour = ipv6Block('[2002::]', 16);

const privateSuffixes: readonly string[] = ['.localhost', '.local', '.localdomain', '.internal', '.home.arpa'];

const metadataServiceNames: ReadonlySet<string> = new Set(['metadata.azure.com', 'metadata.tencentyun.com']);

function isPrivateIpv4(address: number): boolean {
  return privateIpv4Blocks.some((isIn) => isIn(address));
}

function ipv4HeldIn(address: bigint): number | undefined {
  if (ipv6BlocksHoldingIpv4.some((isIn) => isIn(address))) {
    return ipv4InTheLowBitsOf(address);
  }
  return isSixToFour(address) ? ipv4InTheLowBitsOf(address, 80n) : undefined;
}

function isPrivateIpv6(address: bigint): boolean {
  const held = ipv4HeldIn(address);
  return held === undefined ? privateIpv6Blocks.some((isIn) => isIn(address)) : isPrivateIpv4(held);
}

function isPrivateName(canonical: string): boolean {
  return (
    !canonical.includes('.') ||
    metadataServiceNames.has(canonical) ||
    privateSuffixes.some((suffix) => canonical.endsWith(suffix))
  );
}

export function namesAPrivateHost(host: string): boolean {
  const canonical = canonicalHostOf(host);
  if (canonical === undefined) {
    return true;
  }
  const ipv4 = ipv4Of(canonical);
  const ipv6 = ipv6Of(canonical);
  if (ipv4 !== undefined) {
    return isPrivateIpv4(ipv4);
  }
  return ipv6 === undefined ? isPrivateName(canonical) : isPrivateIpv6(ipv6);
}
