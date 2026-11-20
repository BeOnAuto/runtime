import {
  DefaultRoleAskedField,
  DefaultRoleField,
  enrolments,
  joiningIn,
  roleAssignmentDecider,
  type Joining,
} from '@on.auto/access-control';
import { Caller, OrgContext, OrgWriter, defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { NothingAsked, actorOf, writtenNow } from './member-changes.ts';
import { rolesNowOf, rolesOf, theOrg } from './members-read.ts';

const EnrolmentField = Schema.Literals(enrolments).annotate({
  description:
    'invitation, people join when they are invited, or join_without_invitation, anyone who signs in can join with the default role',
});

const JoiningSchema = Schema.Struct({ enrolment: EnrolmentField, default_role: DefaultRoleField });

function answered({ enrolment, defaultRole }: Joining) {
  return { enrolment, default_role: defaultRole };
}

const EnrolmentAskedSchema = Schema.Struct({
  enrolment: EnrolmentField,
  default_role: Schema.optionalKey(DefaultRoleAskedField),
});

function joiningSetBy({ enrolment, default_role }: typeof EnrolmentAskedSchema.Type) {
  return Effect.gen(function* () {
    const actor = yield* actorOf(yield* Caller);
    const { org, by, at } = yield* writtenNow;
    const role = default_role === undefined ? {} : { role: { type: 'built_in', id: default_role } as const };
    const setting = { kind: 'set_enrolment', actor, enrolment, ...role, scope: theOrg(org), at, by } as const;
    const { state } = yield* (yield* OrgWriter).execute(rolesOf(org), roleAssignmentDecider, setting);
    return answered(joiningIn(state));
  });
}

const getEnrolment = defineHttpOperation('org', 'query', {
  name: 'get_enrolment',
  title: 'Get enrolment',
  description:
    'Answers how people who sign in join the org, by invitation or without one, and its default role, the role a person gets when they join without an invitation.',
  route: { method: 'GET', path: '/enrolment' },
  body: { kind: 'none' },
  inputSchema: NothingAsked,
  outputSchema: JoiningSchema,
  reasons: [],
  handle: () =>
    Effect.gen(function* () {
      const { org } = yield* OrgContext;
      return answered(joiningIn(yield* rolesNowOf(org)));
    }),
});

const setEnrolment = defineHttpOperation('org', 'command', {
  name: 'set_enrolment',
  title: 'Set enrolment',
  description:
    'Sets how people who sign in join the org, by invitation or without one, and the role they get when they join without one.',
  route: { method: 'PUT', path: '/enrolment' },
  body: { kind: 'json' },
  inputSchema: EnrolmentAskedSchema,
  outputSchema: JoiningSchema,
  permissionsManagement: true,
  reasons: ['forbidden', 'conflict'],
  handle: (asked) => joiningSetBy(asked),
});

export const joiningOperations = [getEnrolment, setEnrolment] as const;
