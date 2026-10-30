import { Effect, Option, Schema } from 'effect';

import {
  PlaybookRegistry,
  PlaybookReader,
  PlaybookContext,
  PlaybookLifecycle,
  PlaybookWriter,
  Caller,
  IncidentReporter,
  Ledger,
  OrgReader,
  OrgContext,
  OrgWriter,
  defineCommand,
  defineQuery,
} from '../index.ts';

const Empty = Schema.Record(Schema.String, Schema.Never);

interface Sighting {
  readonly name: string;
  readonly found: boolean;
}

const visibleServices = Effect.gen(function* () {
  const services: readonly Sighting[] = [
    { name: 'Ledger', found: Option.isSome(yield* Effect.serviceOption(Ledger)) },
    { name: 'PlaybookRegistry', found: Option.isSome(yield* Effect.serviceOption(PlaybookRegistry)) },
    { name: 'IncidentReporter', found: Option.isSome(yield* Effect.serviceOption(IncidentReporter)) },
    { name: 'Caller', found: Option.isSome(yield* Effect.serviceOption(Caller)) },
    { name: 'OrgContext', found: Option.isSome(yield* Effect.serviceOption(OrgContext)) },
    { name: 'OrgReader', found: Option.isSome(yield* Effect.serviceOption(OrgReader)) },
    { name: 'OrgWriter', found: Option.isSome(yield* Effect.serviceOption(OrgWriter)) },
    { name: 'PlaybookContext', found: Option.isSome(yield* Effect.serviceOption(PlaybookContext)) },
    { name: 'PlaybookLifecycle', found: Option.isSome(yield* Effect.serviceOption(PlaybookLifecycle)) },
    { name: 'PlaybookReader', found: Option.isSome(yield* Effect.serviceOption(PlaybookReader)) },
    { name: 'PlaybookWriter', found: Option.isSome(yield* Effect.serviceOption(PlaybookWriter)) },
  ];
  return services.filter(({ found }) => found).map(({ name }) => name);
});

const OrgView = Schema.Struct({ caller: Schema.String, org: Schema.String, visible: Schema.Array(Schema.String) });

const PlaybookView = Schema.Struct({
  ...OrgView.fields,
  playbook: Schema.String,
  status: Schema.Literals(['active', 'retired']),
});

const viewFromOrg = Effect.fnUntraced(function* () {
  const { id } = yield* Caller;
  const { org } = yield* OrgContext;
  return { caller: id, org, visible: yield* visibleServices };
});

const viewFromPlaybook = Effect.fnUntraced(function* () {
  const { id } = yield* Caller;
  const { org, playbook } = yield* PlaybookContext;
  const { status } = yield* PlaybookLifecycle;
  return { caller: id, org, playbook, status, visible: yield* visibleServices };
});

const peek = { title: 'Peek', description: 'Shows what the handler of a call can see.', reasons: [] };

export const peekOrgQuery = defineQuery('org', {
  ...peek,
  name: 'peek_org_query',
  route: { method: 'GET', path: '/peek' },
  inputSchema: Empty,
  outputSchema: OrgView,
  handle: viewFromOrg,
});

export const peekOrgCommand = defineCommand('org', {
  ...peek,
  name: 'peek_org_command',
  route: { method: 'POST', path: '/peek' },
  inputSchema: Empty,
  outputSchema: OrgView,
  handle: viewFromOrg,
});

export const peekPlaybookQuery = defineQuery('playbook', {
  ...peek,
  name: 'peek_playbook_query',
  route: { method: 'GET', path: '/peek' },
  inputSchema: Empty,
  outputSchema: PlaybookView,
  handle: viewFromPlaybook,
});

export const peekPlaybookCommand = defineCommand('playbook', {
  ...peek,
  name: 'peek_playbook_command',
  route: { method: 'POST', path: '/peek' },
  inputSchema: Empty,
  outputSchema: PlaybookView,
  handle: viewFromPlaybook,
});
