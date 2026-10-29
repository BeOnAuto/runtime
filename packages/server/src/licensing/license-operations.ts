import type { LicensePorts } from '@on.auto/meter';
import { defineHttpOperation } from '@on.auto/operations';
import { Schema } from 'effect';

import { defineActivateLicense } from './activate-license.ts';
import { defineActivateAllocation, defineReportAllocation } from './allocation-operations.ts';
import type { KeptLicenseKey } from './kept-license-key.ts';
import { LicenseStatusSchema } from './license-status-schema.ts';

const description = [
  'Reads where this runtime stands to run: without a key, licensed, out of touch, limited to the free rate and why, or spending offline credits; its id, the first runs it used, the org and plan of its license, the runs it has left, the credits of its org and when Auto last answered it, the free rate while it runs at it, and all of it in plain words with how to put it right.',
  'Every member of an org may read it; the license covers the whole runtime, whatever org the route names.',
].join(' ');

function defineGetLicense(license: Pick<LicensePorts, 'status'>) {
  return defineHttpOperation('org', 'query', {
    name: 'get_license',
    title: 'Get license',
    description,
    route: { method: 'GET', path: '/license' },
    body: { kind: 'none' },
    permittedBy: ['org:read', 'playbook:read'],
    inputSchema: Schema.Record(Schema.String, Schema.Never),
    answer: { kind: 'json', outputSchema: LicenseStatusSchema },
    reasons: ['unavailable'],
    handle: () => license.status,
  });
}

export function licenseOperationsOf(license: LicensePorts, kept: KeptLicenseKey) {
  return [
    defineActivateLicense(license, kept),
    defineActivateAllocation(license),
    defineReportAllocation(license),
    defineGetLicense(license),
  ] as const;
}
