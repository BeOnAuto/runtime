import { BlockList, isIP } from 'node:net';

type Family = 'ipv4' | 'ipv6';

interface ReservedKind {
  readonly name: string;
  readonly subnets: readonly (readonly [string, number, Family])[];
}

const reservedKinds: readonly ReservedKind[] = [
  {
    name: 'a cloud metadata address',
    subnets: [
      ['169.254.169.254', 32, 'ipv4'],
      ['100.100.100.200', 32, 'ipv4'],
      ['fd00:ec2::254', 128, 'ipv6'],
    ],
  },
  {
    name: 'a loopback address',
    subnets: [
      ['127.0.0.0', 8, 'ipv4'],
      ['::1', 128, 'ipv6'],
    ],
  },
  {
    name: 'a link-local address',
    subnets: [
      ['169.254.0.0', 16, 'ipv4'],
      ['fe80::', 10, 'ipv6'],
    ],
  },
  {
    name: 'a private address',
    subnets: [
      ['10.0.0.0', 8, 'ipv4'],
      ['172.16.0.0', 12, 'ipv4'],
      ['192.168.0.0', 16, 'ipv4'],
      ['fc00::', 7, 'ipv6'],
    ],
  },
  { name: 'a shared address of a carrier-grade NAT', subnets: [['100.64.0.0', 10, 'ipv4']] },
  {
    name: 'an unspecified address',
    subnets: [
      ['0.0.0.0', 8, 'ipv4'],
      ['::', 128, 'ipv6'],
    ],
  },
  {
    name: 'a reserved address',
    subnets: [
      ['192.0.0.0', 24, 'ipv4'],
      ['198.18.0.0', 15, 'ipv4'],
      ['224.0.0.0', 4, 'ipv4'],
      ['240.0.0.0', 4, 'ipv4'],
      ['ff00::', 8, 'ipv6'],
    ],
  },
];

const reservedNames: ReadonlyMap<string, string> = new Map([['metadata.google.internal', 'a cloud metadata host']]);

const loopbackName = 'a loopback host';

const embeddingIPv4 = /^(?:::ffff:|64:ff9b::)[0-9a-f]{1,4}:[0-9a-f]{1,4}$/u;

function blockListOf({ subnets }: ReservedKind): BlockList {
  const list = new BlockList();
  subnets.forEach(([network, prefix, family]) => {
    list.addSubnet(network, prefix, family);
  });
  return list;
}

const blockLists: readonly (readonly [string, Readonly<BlockList>])[] = reservedKinds.map((kind) => [
  kind.name,
  blockListOf(kind),
]);

function withoutBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function withoutScope(address: string): string {
  const scoped = address.indexOf('%');
  return scoped < 0 ? address : address.slice(0, scoped);
}

function octetsOf(group: string): readonly number[] {
  const value = Number.parseInt(group, 16);
  return [value >> 8, value & 0xff];
}

function embeddedIPv4Of(address: string): string | undefined {
  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  return embeddingIPv4.test(canonical)
    ? canonical
        .split(':')
        .slice(-2)
        .flatMap((group) => octetsOf(group))
        .join('.')
    : undefined;
}

function kindOfAddress(address: string): string | undefined {
  const family = isIP(address) === 4 ? 'ipv4' : 'ipv6';
  return blockLists.find(([, list]) => list.check(address, family))?.[0];
}

function hostWithoutDecoration(host: string): string {
  const bare = withoutBrackets(host.toLowerCase());
  return bare.endsWith('.') ? bare.slice(0, -1) : bare;
}

export function reservedAddressKindOf(address: string): string | undefined {
  const bare = withoutScope(withoutBrackets(address));
  if (isIP(bare) === 0) {
    return undefined;
  }
  const embedded = isIP(bare) === 6 ? embeddedIPv4Of(bare) : undefined;
  return kindOfAddress(embedded ?? bare);
}

export function reservedHostKindOf(host: string): string | undefined {
  const bare = hostWithoutDecoration(host);
  if (bare === 'localhost' || bare.endsWith('.localhost')) {
    return loopbackName;
  }
  return reservedNames.get(bare) ?? reservedAddressKindOf(bare);
}
