import { isFilledAround, placeholdersIn, textsAroundPlaceholders } from '@on.auto/config';
import { reservedHostKindOf } from '@on.auto/outbound';

import type { ConnectionPolicy } from '../policy/connection-policy.ts';
import { allowsReserved, hostRefusalOf } from '../policy/policy-rules.ts';

const placedHostCharacters = /^[a-z0-9-]+$/u;

function isPlacedInAHost(placed: string): boolean {
  return placedHostCharacters.test(placed);
}

function fitsTheShapeOf(template: string, pattern: string): boolean {
  const around = textsAroundPlaceholders(template).map((text) => text.toLowerCase());
  return isFilledAround(around, pattern, isPlacedInAHost);
}

function fixedTailOf(template: string): string {
  return template.slice(template.lastIndexOf('}') + 1).toLowerCase();
}

function couldBeAllowed(pattern: string, template: string): boolean {
  const lowered = pattern.toLowerCase();
  return lowered.startsWith('*.')
    ? fixedTailOf(template).endsWith(lowered.slice(1))
    : fitsTheShapeOf(template, lowered);
}

export function couldReach(policy: ConnectionPolicy, host: string): boolean {
  const { allowedHosts } = policy;
  if (allowedHosts === null) {
    return placeholdersIn(host).length > 0 || reservedHostKindOf(host) === undefined || allowsReserved(policy, host);
  }
  return placeholdersIn(host).length === 0
    ? hostRefusalOf(allowedHosts, host.toLowerCase()) === undefined
    : allowedHosts.some((pattern) => couldBeAllowed(pattern, host));
}

export function couldReachAnyHost({ allowedHosts }: ConnectionPolicy): boolean {
  return allowedHosts === null || allowedHosts.length > 0;
}
