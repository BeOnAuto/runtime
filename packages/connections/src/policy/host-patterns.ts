import { canonicalHostOf } from '@on.auto/operations';
import { Schema } from 'effect';

import { heldAsWritten } from '../registered-clients/reference-fields.ts';

const hostLabel = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';

export const HostPatternSchema = Schema.String.check(
  heldAsWritten,
  Schema.isPattern(new RegExp(`^(?:\\*\\.)?${hostLabel}(?:\\.${hostLabel})*$`, 'u'), {
    message: 'Expected a host, such as crm.example.com, or a host after *. for every host under it',
  }),
);

export const PrivateHostPatternSchema = Schema.String.check(
  heldAsWritten,
  Schema.isPattern(new RegExp(`^(?:(?:\\*\\.)?${hostLabel}(?:\\.${hostLabel})*|\\[[0-9A-Fa-f:.]+\\])$`, 'u'), {
    message:
      'Expected a host, such as localhost or 10.0.0.5, an IPv6 address in brackets, such as [::1], or a host after *. for every host under it',
  }),
);

export function canonicalPatternOf(pattern: string): string {
  return pattern.startsWith('*.') ? pattern.toLowerCase() : (canonicalHostOf(pattern) ?? pattern.toLowerCase());
}
