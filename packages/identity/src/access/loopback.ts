import { BlockList, isIP } from 'node:net';

const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
loopbackAddresses.addAddress('::1', 'ipv6');

export function listensOnlyOnLoopback(host: string): boolean {
  return host === 'localhost' || loopbackAddresses.check(host, isIP(host) === 6 ? 'ipv6' : 'ipv4');
}
