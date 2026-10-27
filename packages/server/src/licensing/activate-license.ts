import type { LicensePorts } from '@on.auto/meter';
import { Caller, defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { KeptLicenseKey } from './kept-license-key.ts';
import { LicenseKey } from './license-settings.ts';

const ActivationSchema = Schema.Struct({ key: LicenseKey });

const LicenseSchema = Schema.Struct({
  installation: Schema.String,
  org: Schema.String,
  plan: Schema.String,
  expires_at: Schema.String,
});

const description = [
  'Activates the license of this runtime with the key Studio gave as an owner of the org registered its installation, alk.<org>.<installation>.<secret>.',
  'The license covers the whole runtime, every org of it: from then on each new action is admitted against the credit of the account of the org at Auto, and the 100 actions a runtime runs before it is registered no longer count.',
  'It answers the installation, the org at Auto, its plan and when the entitlement Auto signed expires; the runtime refreshes it every day, and keeps the key in its secret store so it stands after a restart.',
  'A key Auto does not know, or one for another installation, is refused as a conflict of the kind license_invalid.',
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
    outputSchema: LicenseSchema,
    reasons: ['invalid_input', 'conflict', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ key }) {
      const standing = yield* license.activate(key);
      yield* kept.keep(key, (yield* Caller).id);
      return standing;
    }),
    plainLanguage: {
      task: 'activate the license of this runtime',
      attempt: () => 'activate the license with the key given',
      outcome: ({ org, plan, expires_at: expiresAt }) =>
        `This runtime is licensed to the org ${org} on the plan ${plan} until ${expiresAt}, and renews its license every day.`,
    },
  });
}
