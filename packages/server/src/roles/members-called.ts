import type { PersonRow } from '@on.auto/openid-connect';
import { allPermissions, playbookCallerOf, type CallerIdentity } from '@on.auto/operations';
import { Schema } from 'effect';

const anHour = 3_600_000;

const signedInAt = Date.parse('2026-11-18T09:00:00.000Z');

export const aMonthOn = '2026-12-19T16:00:00.000Z';

export const longAgo = '2026-10-01T09:00:00.000Z';

function aPerson(subject: string): CallerIdentity {
  return { id: `person:${subject}`, name: subject, org: 'acme', permissions: allPermissions, playbooks: '*' };
}

export const ada = aPerson('ada');

export const priya = aPerson('priya');

export const dana = aPerson('dana');

export const adasAgent: CallerIdentity = { ...ada, client: { id: 'client-7', name: 'An agent', domain: null } };

export const danasAgent: CallerIdentity = { ...dana, client: { id: 'client-8', name: 'An agent', domain: null } };

export const ciKey: CallerIdentity = { ...ada, id: 'ci-key', name: 'ci-key' };

export const alpha: CallerIdentity = {
  ...playbookCallerOf({ org: 'acme', playbook: 'alpha' }),
  permissions: allPermissions,
};

export const everyone: readonly PersonRow[] = [
  { person: 'ada', name: 'Ada Lovelace', emailAddress: 'ada@example.com', joinedAt: signedInAt, updatedAt: signedInAt },
  {
    person: 'priya',
    emailAddress: 'Priya@Example.com',
    joinedAt: signedInAt + anHour,
    updatedAt: signedInAt + anHour,
  },
  {
    person: 'grace',
    name: 'Grace Hopper',
    emailAddress: 'grace@example.com',
    joinedAt: signedInAt + 2 * anHour,
    updatedAt: signedInAt + 2 * anHour,
  },
];

const SucceededSchema = Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Json });

export const outputOf = (outcome: unknown) => Schema.decodeUnknownSync(SucceededSchema)(outcome).output;

const MadeSchema = Schema.Struct({ id: Schema.String, link: Schema.String });

export const madeOf = (outcome: unknown) => Schema.decodeUnknownSync(MadeSchema)(outputOf(outcome));

const ListedSchema = Schema.Struct({
  members: Schema.Array(Schema.Unknown),
  members_total: Schema.Number,
  invitations: Schema.Array(Schema.Struct({ id: Schema.String, email_address: Schema.String })),
});

export const listedOf = (outcome: unknown) => Schema.decodeUnknownSync(ListedSchema)(outputOf(outcome));

export function refusedAs(reason: string, detail: string) {
  return { status: 'rejected', reason, detail };
}
