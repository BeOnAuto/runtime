import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  InAConversation,
  PlaybookIdSchema,
  allPermissions,
  defineCommand,
  defineQuery,
  noLineage,
  playbookCallerOf,
  type AccessRequest,
  type CallerIdentity,
  type Dispatcher,
  type DispatcherServices,
  type Outcome,
  type PlaybookRequest,
} from '../index.ts';
import { acmeAdmin, acmeAlphaReader } from '../testing/callers.ts';
import { allowedByTheTest, recordingDecisionPoint } from '../testing/decision-points.ts';
import { harness, toOrg, toPlaybook } from '../testing/harness.ts';
import { addNote, getNote } from '../testing/notes.ts';
import { labelPlaybook, listPlaybookLabels } from '../testing/playbook-labels.ts';

const ada: CallerIdentity = {
  id: 'person:user_ada',
  name: 'Ada Lovelace',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

const adasAgent: CallerIdentity = { ...ada, client: { id: 'client-7', name: 'An agent', domain: null } };

const localDeveloper: CallerIdentity = {
  id: 'local',
  name: 'grace',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

const declaredOfAQuery = {
  kind: 'query',
  targetsPlaybook: false,
  readsOnly: false,
  reachesOutside: false,
  mayChangeOutside: false,
  irreversible: false,
  permissionsManagement: false,
  enrolment: false,
};

const searchLabels = defineQuery('org', {
  name: 'search_labels',
  title: 'Search labels',
  description: 'Searches the labels of the org, or of the playbook it names.',
  route: { method: 'GET', path: '/label-search' },
  inputSchema: Schema.Struct({ playbook: Schema.optionalKey(PlaybookIdSchema) }),
  outputSchema: Schema.Struct({ searched: Schema.Boolean }),
  reasons: [],
  handle: () => Effect.succeed({ searched: true }),
});

const retireEverything = defineCommand('playbook', {
  name: 'retire_everything',
  title: 'Retire everything',
  description: 'Retires what a service outside holds, which cannot be undone.',
  route: { method: 'POST', path: '/everything/retirement' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ retired: Schema.Boolean }),
  reasons: [],
  reachesOutside: true,
  mayChangeOutside: true,
  irreversible: true,
  handle: () => Effect.succeed({ retired: true }),
});

const askOutside = defineCommand('playbook', {
  name: 'ask_outside',
  title: 'Ask outside',
  description: 'Asks a service outside, which only reads, and records the answer.',
  route: { method: 'POST', path: '/questions' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ asked: Schema.Boolean }),
  reasons: [],
  reachesOutside: true,
  readsOnly: true,
  handle: () => Effect.succeed({ asked: true }),
});

const shareNotes = defineCommand('playbook', {
  name: 'share_notes',
  title: 'Share notes',
  description: 'Lets a person read the notes of the playbook, which changes who may do what.',
  route: { method: 'POST', path: '/notes/readers' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ shared: Schema.Boolean }),
  reasons: [],
  permissionsManagement: true,
  handle: () => Effect.succeed({ shared: true }),
});

type Dispatched = (dispatcher: Dispatcher) => Effect.Effect<Outcome, never, DispatcherServices>;

async function askedFor(dispatched: Dispatched, inAConversation = false): Promise<readonly AccessRequest[]> {
  const recording = recordingDecisionPoint(() => allowedByTheTest);
  const { dispatcher, run } = harness({ reportOnly: recording.decisionPoint });
  await run(Effect.provideService(dispatched(dispatcher), InAConversation, inAConversation));
  return recording.asked();
}

const onAlpha = toPlaybook('acme', 'alpha');

describe('the question the dispatcher asks in report-only mode', () => {
  it('names a signed-in person by the subject their id carries, the operation by its scope and name, and the playbook of the call in its org', async () => {
    expect(
      await askedFor((dispatcher) =>
        dispatcher.dispatchToPlaybook(getNote.registration, onAlpha(ada, { name: 'anvil' })),
      ),
    ).toEqual([
      {
        principal: { type: 'person', id: 'user_ada' },
        action: { scope: 'playbook', name: 'get_note' },
        resource: { type: 'playbook', id: 'alpha', org: 'acme' },
        context: {
          via: 'studio',
          granted: { org: 'acme', permissions: allPermissions, playbooks: '*' },
          operation: declaredOfAQuery,
        },
      },
    ]);
  });

  it('says a person arrived through an agent when their credential was issued to a client', async () => {
    const [asked] = await askedFor((dispatcher) =>
      dispatcher.dispatchToPlaybook(getNote.registration, onAlpha(adasAgent, { name: 'anvil' })),
    );

    expect(asked?.context.via).toBe('agent');
  });
});

describe('the principal of the question', () => {
  it('names a key, the local developer and a playbook acting as itself, each arriving its own way', async () => {
    const asked = await Promise.all(
      [acmeAlphaReader, localDeveloper, playbookCallerOf({ org: 'acme', playbook: 'alpha' })].map(async (caller) => {
        const [question] = await askedFor((dispatcher) =>
          dispatcher.dispatchToPlaybook(getNote.registration, onAlpha(caller, { name: 'anvil' })),
        );
        return { principal: question?.principal, via: question?.context.via, granted: question?.context.granted };
      }),
    );

    expect(asked).toEqual([
      {
        principal: { type: 'key', id: 'acme-alpha-reader' },
        via: 'key',
        granted: { org: 'acme', permissions: ['org:read', 'playbook:read'], playbooks: ['alpha'] },
      },
      {
        principal: { type: 'local_developer', id: 'local' },
        via: 'local',
        granted: { org: 'acme', permissions: allPermissions, playbooks: '*' },
      },
      {
        principal: { type: 'playbook', id: 'alpha' },
        via: 'run',
        granted: { org: 'acme', permissions: ['playbook:read', 'playbook:write'], playbooks: ['alpha'] },
      },
    ]);
  });
});

describe('how the question says a call arrived, and what it asks about', () => {
  it('says a call a run makes arrived through the run, whether a step of a workflow, a trigger or the run itself made it', async () => {
    const byAStep: PlaybookRequest = {
      ...onAlpha(ada, { name: 'anvil' }),
      calledBy: { run_id: 'run-1', reference: 'steps/0', run: 1 },
    };
    const byATrigger: PlaybookRequest = {
      ...onAlpha(ada, { name: 'anvil' }),
      trigger: { kind: 'cron', reference: 'daily' },
    };
    const byItsRun: PlaybookRequest = {
      ...onAlpha(ada, { name: 'anvil' }),
      lineage: { causationId: null, correlationId: 'run-2' },
    };
    const ofNoRun: PlaybookRequest = { ...onAlpha(ada, { name: 'anvil' }), lineage: noLineage };

    const asked = await Promise.all(
      [byAStep, byATrigger, byItsRun, ofNoRun, onAlpha(ada, { name: 'anvil' })].map(async (request) => {
        const [question] = await askedFor((dispatcher) => dispatcher.dispatchToPlaybook(getNote.registration, request));
        return question?.context.via;
      }),
    );

    expect(asked).toEqual(['run', 'run', 'run', 'studio', 'studio']);
  });

  it('asks about the playbook an org operation names, and about the org where it names none or targets none', async () => {
    const toAcme = toOrg('acme');
    const resources = await Promise.all(
      [
        (dispatcher: Dispatcher) =>
          dispatcher.dispatchToOrg(labelPlaybook.registration, toAcme(ada, { playbook: 'beta', label: 'red' })),
        (dispatcher: Dispatcher) => dispatcher.dispatchToOrg(searchLabels.registration, toAcme(ada, {})),
        (dispatcher: Dispatcher) => dispatcher.dispatchToOrg(searchLabels.registration, toAcme(ada, { playbook: 42 })),
        (dispatcher: Dispatcher) => dispatcher.dispatchToOrg(listPlaybookLabels.registration, toAcme(ada, {})),
      ].map(async (dispatched) => {
        const [question] = await askedFor(dispatched);
        return { resource: question?.resource, targetsPlaybook: question?.context.operation.targetsPlaybook };
      }),
    );

    expect(resources).toEqual([
      { resource: { type: 'playbook', id: 'beta', org: 'acme' }, targetsPlaybook: true },
      { resource: { type: 'org', id: 'acme' }, targetsPlaybook: true },
      { resource: { type: 'org', id: 'acme' }, targetsPlaybook: true },
      { resource: { type: 'org', id: 'acme' }, targetsPlaybook: false },
    ]);
  });
});

describe('a call made within a turn of a conversation', () => {
  it('says a person’s call made within a turn of a conversation arrived through the conversation, whatever their credential, and a key’s and a run’s as ever', async () => {
    const byItsRun: PlaybookRequest = {
      ...onAlpha(ada, { name: 'anvil' }),
      lineage: { causationId: null, correlationId: 'run-2' },
    };
    const asked = await Promise.all(
      [
        onAlpha(ada, { name: 'anvil' }),
        onAlpha(adasAgent, { name: 'anvil' }),
        onAlpha(acmeAlphaReader, {}),
        byItsRun,
      ].map(async (request) => {
        const [question] = await askedFor(
          (dispatcher) => dispatcher.dispatchToPlaybook(getNote.registration, request),
          true,
        );
        return question?.context.via;
      }),
    );
    const [ofTheOrg] = await askedFor(
      (dispatcher) => dispatcher.dispatchToOrg(listPlaybookLabels.registration, toOrg('acme')(adasAgent, {})),
      true,
    );

    expect([...asked, ofTheOrg?.context.via]).toEqual(['conversation', 'conversation', 'key', 'run', 'conversation']);
  });
});

describe('what else the question carries', () => {
  it('carries what the operation declares about itself, and nothing of its input', async () => {
    const declared = await Promise.all(
      [addNote.registration, retireEverything.registration, askOutside.registration, shareNotes.registration].map(
        async (registration) => {
          const [question] = await askedFor((dispatcher) =>
            dispatcher.dispatchToPlaybook(registration, onAlpha(ada, { name: 'anvil', text: 'a secret' })),
          );
          return question?.context.operation;
        },
      ),
    );

    expect(declared).toEqual([
      { ...declaredOfAQuery, kind: 'command' },
      { ...declaredOfAQuery, kind: 'command', reachesOutside: true, mayChangeOutside: true, irreversible: true },
      { ...declaredOfAQuery, kind: 'command', reachesOutside: true, readsOnly: true },
      { ...declaredOfAQuery, kind: 'command', permissionsManagement: true },
    ]);
    expect(JSON.stringify(declared)).not.toContain('a secret');
  });

  it('is not asked for a caller whose id names no kind of principal', async () => {
    const service = { ...acmeAdmin, id: 'service:mailer' };

    expect(
      await askedFor((dispatcher) =>
        dispatcher.dispatchToPlaybook(getNote.registration, onAlpha(service, { name: 'anvil' })),
      ),
    ).toEqual([]);
  });
});
