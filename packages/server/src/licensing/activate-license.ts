import type { LicensePorts } from '@on.auto/meter';
import { Caller, defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { KeptLicenseKey } from './kept-license-key.ts';
import { LicenseKey } from './license-settings.ts';
import { LicenseStatusSchema } from './license-status-schema.ts';

const ActivationSchema = Schema.Struct({ key: LicenseKey });

const description = [
  'Activates the license of this runtime with the key Studio gave as an owner of the org registered it, alk.<org>.<runtime id>.<secret>.',
  'The license covers the whole runtime, every org of it: from then on it starts runs on the credits of the org at Auto, without asking Auto for each, and reports the runs it started every hour, and sooner once it has used half of what its license left it.',
  'It answers where the runtime stands, as get_license does, and keeps the key in its secret store so it stands after a restart.',
  'A key Auto does not know, one that was replaced or one for another runtime is refused as a conflict of the kind license_invalid, and a key of a closed org as account_closed.',
].join(' ');

export function defineActivateLicense(license: Pick<LicensePorts, 'activate'>, kept: KeptLicenseKey) {
  return defineCommand('org', {
    name: 'activate_license',
    title: 'Activate license',
    description,
    route: { method: 'POST', path: '/license' },
    reachesOutside: true,
    repeatable: true,
    inputSchema: ActivationSchema,
    outputSchema: LicenseStatusSchema,
    reasons: ['invalid_input', 'conflict', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ key }) {
      const status = yield* license.activate(key);
      yield* kept.keep(key, (yield* Caller).id);
      return status;
    }),
    plainLanguage: {
      task: 'activate the license of this runtime',
      attempt: () => 'activate the license with the key given',
      outcome: ({ summary }) => summary,
    },
  });
}
