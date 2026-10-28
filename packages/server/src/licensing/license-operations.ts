import type { LicensePorts } from '@on.auto/meter';
import { defineHttpOperation } from '@on.auto/operations';
import { Schema } from 'effect';

import { defineActivateLicense } from './activate-license.ts';
import { defineActivateAllocation, defineReportAllocation } from './allocation-operations.ts';
import type { KeptLicenseKey } from './kept-license-key.ts';

function orNull<S extends Schema.Constraint>(schema: S, description: string): Schema.NullOr<S> {
  return Schema.NullOr(schema).annotate({ description });
}

const LicenseStatusSchema = Schema.Struct({
  state: Schema.Literals(['unregistered', 'licensed', 'offline', 'invalid']).annotate({
    description:
      'unregistered before a key is given, licensed while an entitlement Auto signed stands, offline while it spends an allocation, invalid while what it holds does not stand',
  }),
  runtime_id: Schema.String.annotate({
    description: 'The id of this runtime, the installation an owner registers in Studio',
  }),
  free_runs: Schema.Struct({
    used: Schema.Int.annotate({ description: 'The runs it has counted, at most the free runs it may make' }),
    of: Schema.Int.annotate({ description: 'The runs it may make before it is registered' }),
  }),
  org: orNull(Schema.String, 'The org at Auto its license is of'),
  plan: orNull(Schema.String, 'The plan of that org'),
  expires_at: orNull(Schema.String, 'When the entitlement Auto signed ends, unless the runtime renews it'),
  renewed_at: orNull(Schema.String, 'When Auto last signed its entitlement'),
  key_source: orNull(
    Schema.Literals(['environment', 'configuration', 'activated']),
    'Where the key in force came from: AUTO_RUNTIME_LICENSE_KEY, license.key of the configuration file, or an activation',
  ),
  offline: orNull(
    Schema.Struct({
      credits: Schema.Int.annotate({ description: 'The credits of the allocation it holds' }),
      spent: Schema.Int.annotate({ description: 'What it has spent of them' }),
      usable_until: Schema.String.annotate({ description: 'When they stop unless Auto refreshes them' }),
    }),
    'The allocation of an installation that does not reach Auto',
  ),
  invalid_because: orNull(Schema.String, 'While it is invalid, the words a run is refused in'),
});

const description = [
  'Reads what this runtime holds to run: whether it is unregistered, licensed, offline or invalid, its id, the free runs it has used, the org and plan of its license, where its key came from and the offline credits it spends.',
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
