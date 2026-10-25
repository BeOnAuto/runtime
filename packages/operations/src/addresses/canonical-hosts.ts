const dottedQuad = /^(?:\d{1,3}\.){3}\d{1,3}$/u;

const groupsInIpv6 = 8;

const bitsInIpv6 = 128n;

function writtenHostOf(host: string): string {
  const lowered = host.toLowerCase().replace(/\.+$/u, '');
  return lowered.includes(':') && !lowered.startsWith('[') ? `[${lowered}]` : lowered;
}

export function canonicalHostOf(host: string): string | undefined {
  return URL.parse(`http://${writtenHostOf(host)}/`)?.hostname.replace(/\.+$/u, '');
}

function ipv4ValueOf(dotted: string): number {
  return dotted.split('.').reduce((address, octet) => address * 256 + Number(octet), 0);
}

export function ipv4Of(canonical: string): number | undefined {
  return dottedQuad.test(canonical) ? ipv4ValueOf(canonical) : undefined;
}

export function ipv4Block(dotted: string, prefix: number): (address: number) => boolean {
  const size = 2 ** (32 - prefix);
  const start = Math.floor(ipv4ValueOf(dotted) / size);
  return (address) => Math.floor(address / size) === start;
}

function groupsOf(written: string | undefined): readonly string[] {
  return written === undefined || written === '' ? [] : written.split(':');
}

function ipv6ValueOf(bracketed: string): bigint {
  const [head, tail] = bracketed.slice(1, -1).split('::');
  const leading = groupsOf(head);
  const trailing = groupsOf(tail);
  const zeros = Array.from({ length: groupsInIpv6 - leading.length - trailing.length }, () => '0');
  return [...leading, ...zeros, ...trailing].reduce((address, group) => (address << 16n) + BigInt(`0x${group}`), 0n);
}

export function ipv6Of(canonical: string): bigint | undefined {
  return canonical.startsWith('[') ? ipv6ValueOf(canonical) : undefined;
}

export function ipv6Block(bracketed: string, prefix: number): (address: bigint) => boolean {
  const shift = bitsInIpv6 - BigInt(prefix);
  const start = ipv6ValueOf(bracketed) >> shift;
  return (address) => address >> shift === start;
}

export function ipv4InTheLowBitsOf(address: bigint, shift = 0n): number {
  return Number((address >> shift) & 0xffffffffn);
}
