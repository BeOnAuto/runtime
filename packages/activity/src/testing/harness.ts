import {
  StudioLinks,
  allPermissions,
  makeDispatcher,
  type CallerIdentity,
  type OrgRequest,
  type PlaybookRequest,
  type Outcome,
  type Runnable,
  type StudioPage,
} from '@on.auto/operations';
import { memoryLedger, recordingReporter } from '@on.auto/operations/testing';
import {
  createPlaybook,
  defineUpdatePlaybook,
  ledgerPlaybookRegistry,
  retirePlaybook,
  type PlaybookPages,
} from '@on.auto/playbooks';
import { DateTime, Effect, Layer, Schema } from 'effect';
import { TestClock } from 'effect/testing';

import { activityProjections } from '../composition/activity-composition.ts';
import { listActivity } from '../operations/list-activity.ts';
import { markActivitySeen } from '../operations/mark-activity-seen.ts';
import { recorded, type RecordedFact } from './recorded-facts.ts';

const now = '2026-11-01T18:00:00.000Z';

export const ada: CallerIdentity = {
  id: 'person:user_2ada',
  name: 'Ada Lovelace',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export const priya: CallerIdentity = { ...ada, id: 'person:user_7kLm2', name: 'Priya Shah' };

export const localDeveloper: CallerIdentity = { ...ada, id: 'local', name: 'sam' };

export const salesReader: CallerIdentity = {
  ...ada,
  id: 'key_sales',
  name: 'key_sales',
  permissions: ['playbook:read'],
  playbooks: ['sales'],
};

const SucceededSchema = Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Json });

export const outputOf = (outcome: Outcome): Schema.Json => Schema.decodeUnknownSync(SucceededSchema)(outcome).output;

const CountsSchema = Schema.Struct({
  needs_you: Schema.Int,
  broken: Schema.Int,
  new: Schema.Int,
  comments: Schema.Int,
});

const ThroughSchema = Schema.NullOr(Schema.Struct({ cursor: Schema.String, seen_at: Schema.String }));

const ListedSchema = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({
      address: Schema.String,
      cursor: Schema.String,
      at: Schema.String,
      by: Schema.String,
      seen: Schema.NullOr(Schema.Boolean),
    }),
  ),
  has_more: Schema.Boolean,
  next_cursor: Schema.NullOr(Schema.String),
  counts: CountsSchema,
  through: ThroughSchema,
});

export const listedOf = (outcome: Outcome) => Schema.decodeUnknownSync(ListedSchema)(outputOf(outcome));

export const markedOf = (outcome: Outcome) =>
  Schema.decodeUnknownSync(Schema.Struct({ counts: CountsSchema, through: ThroughSchema }))(outputOf(outcome));

interface OrgOperation {
  readonly registration: Runnable<'org'>;
}

interface PlaybookOperation {
  readonly registration: Runnable<'playbook'>;
}

interface PlaybookCall {
  readonly caller: CallerIdentity;
  readonly playbook: string;
  readonly input: Schema.JsonObject | Readonly<Record<string, string>>;
  readonly at?: string;
  readonly encoding?: 'json' | 'strings';
}

export function studioPageOf(page?: StudioPage): string {
  return `https://studio.example/?page=${encodeURIComponent(JSON.stringify(page))}`;
}

function playbookRequestOf({ caller, playbook, input, encoding = 'json' }: PlaybookCall): PlaybookRequest {
  return { caller, org: 'acme', playbook, input, encoding };
}

const noPage = () => Effect.undefined;

const noPages: PlaybookPages = { pageOf: noPage, save: noPage };

const updatePlaybook = defineUpdatePlaybook(noPages);

export function activityHarness() {
  const ledger = memoryLedger(undefined, activityProjections);
  const services = Layer.mergeAll(
    ledger.layer,
    Layer.provide(ledgerPlaybookRegistry, ledger.layer),
    recordingReporter().layer,
    TestClock.layer(),
  );
  const dispatcher = makeDispatcher([]);
  const atTime = <A>(at: string, effect: Effect.Effect<A, never, Layer.Success<typeof services>>) =>
    Effect.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
        Effect.andThen(effect),
        Effect.provide(services),
        Effect.provideService(StudioLinks, studioPageOf),
      ),
    );
  const call = (operation: OrgOperation, request: OrgRequest, at = now) =>
    atTime(at, dispatcher.dispatchToOrg(operation.registration, request));
  const inPlaybook = (operation: PlaybookOperation, asked: PlaybookCall) =>
    atTime(asked.at ?? now, dispatcher.dispatchToPlaybook(operation.registration, playbookRequestOf(asked)));
  return {
    ledger,
    call,
    inPlaybook,
    created: (caller: CallerIdentity, playbook: string, at: string) =>
      call(createPlaybook, { caller, org: 'acme', input: { playbook, name: playbook }, encoding: 'json' }, at),
    updated: (caller: CallerIdentity, playbook: string, at: string) =>
      call(
        updatePlaybook,
        { caller, org: 'acme', input: { playbook, name: 'Finance', description: '' }, encoding: 'json' },
        at,
      ),
    retired: (caller: CallerIdentity, playbook: string, at: string) =>
      call(retirePlaybook, { caller, org: 'acme', input: { playbook }, encoding: 'json' }, at),
    record: (stream: string, ...facts: readonly RecordedFact[]) => recorded(ledger, stream, facts),
    list: (caller: CallerIdentity, input: Readonly<Record<string, string>> = {}, at = now) =>
      call(listActivity, { caller, org: 'acme', input, encoding: 'strings' }, at),
    mark: (caller: CallerIdentity, input: Schema.JsonObject, at = now) =>
      call(markActivitySeen, { caller, org: 'acme', input, encoding: 'json' }, at),
  };
}
