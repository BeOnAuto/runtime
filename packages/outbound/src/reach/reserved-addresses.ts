import { BlockList, isIP } from 'node:net';

type Family = 'ipv4' | 'ipv6';

interface ReservedKind {
  readonly name: string;
  readonly subnets: readonly (readonly [string, number, Family])[];
}

const loopbackName = 'a loopback host';

const loopbackAddress = 'a loopback address';

const metadataAddress = 'a cloud metadata address';

const metadataHost = 'a cloud metadata host';

const reservedKinds: readonly ReservedKind[] = [
  {
    name: metadataAddress,
    subnets: [
      ['169.254.169.254', 32, 'ipv4'],
      ['100.100.100.200', 32, 'ipv4'],
      ['fd00:ec2::254', 128, 'ipv6'],
    ],
  },
  {
    name: loopbackAddress,
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
      ['fec0::', 10, 'ipv6'],
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
      ['64:ff9b:1::', 48, 'ipv6'],
    ],
  },
];

const reservedNames: ReadonlyMap<string, string> = new Map([['metadata.google.internal', metadataHost]]);

interface Embedding {
  readonly prefix: readonly number[];
  readonly from: number;
}

const embeddings: readonly Embedding[] = [
  { prefix: [0, 0, 0, 0, 0, 0xffff], from: 6 },
  { prefix: [0, 0, 0, 0, 0xffff, 0], from: 6 },
  { prefix: [0x64, 0xff9b, 0, 0, 0, 0], from: 6 },
  { prefix: [0, 0, 0, 0, 0, 0], from: 6 },
  { prefix: [0x2002], from: 1 },
];

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

function octetsOf(group: number): readonly number[] {
  return [group >> 8, group & 0xff];
}

function groupsOf(canonical: string): readonly number[] {
  const written = canonical.split(':').filter((group) => group !== '').length;
  const expanded = canonical.replace('::', `:${'0:'.repeat(8 - written)}`);
  return expanded
    .split(':')
    .filter((group) => group !== '')
    .map((group) => Number.parseInt(group, 16));
}

function embeddedIPv4Of(address: string): string | undefined {
  const groups = groupsOf(new URL(`http://[${address}]`).hostname.slice(1, -1));
  const embedding = embeddings.find(({ prefix }) => prefix.every((group, index) => groups[index] === group));
  return embedding === undefined
    ? undefined
    : groups
        .slice(embedding.from, embedding.from + 2)
        .flatMap((group) => octetsOf(group))
        .join('.');
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
  return kindOfAddress(bare) ?? (embedded === undefined ? undefined : kindOfAddress(embedded));
}

export function reservedHostKindOf(host: string): string | undefined {
  const bare = hostWithoutDecoration(host);
  if (bare === 'localhost' || bare.endsWith('.localhost')) {
    return loopbackName;
  }
  return reservedNames.get(bare) ?? reservedAddressKindOf(bare);
}

const unnameable: ReadonlySet<string> = new Set([metadataAddress, metadataHost]);

export function operatorMayNameHost(host: string): boolean {
  const kind = reservedHostKindOf(host);
  return kind !== undefined && !unnameable.has(kind);
}

export function loopbackHostOf(host: string): boolean {
  const kind = reservedHostKindOf(host);
  return kind === loopbackName || kind === loopbackAddress;
}
