import {
  type DefinitionSaved,
  type DispatcherServices,
  type Outcome,
  StudioLinks,
  type StudioPage,
} from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { type Capability, defineCapability } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { asQueryString, firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const someWords: unknown = expect.any(String);

const { createDefinition, listDefinitions, retireDefinition } = definitionOperationsFor([echo, probe().capability]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const activeOnly = { status: 'succeeded', output: { definitions: [{ name: 'alpha' }, { name: 'gamma' }] } };

const retiredToo = {
  status: 'succeeded',
  output: {
    definitions: [{ name: 'alpha' }, { name: 'beta', status: 'retired', retired_at: later }, { name: 'gamma' }],
  },
};

const anId: unknown = expect.any(String);

function listed(name: string) {
  return {
    type: 'probe',
    name,
    definition_id: anId,
    version: 1,
    status: 'active',
    media_type: 'text/plain',
    created_at: firstMoment,
    created_by: { id: 'acme-admin', name: 'acme-admin' },
    updated_at: firstMoment,
  };
}

async function withGammaAlphaAndRetiredBeta() {
  const definitions = harness();
  const creating = (name: string) =>
    definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name, source: name }));
  await creating('gamma');
  await creating('alpha');
  await creating('beta');
  await definitions.call(retireDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'beta' }), later);
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'delta', source: '{"greeting": "Hi"}' }),
  );
  return definitions;
}

const {
  createDefinition: createDefinitionInStudioPages,
  updateDefinition,
  runDefinition,
} = definitionOperationsFor([echo]);

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

function pageOf(page?: StudioPage): string {
  return `https://studio.example/${JSON.stringify(page)}`;
}

function greetAt(definition: string, version: number, saved?: DefinitionSaved): StudioPage {
  return {
    kind: 'definition',
    playbook: 'alpha',
    type: 'echo',
    name: 'greet',
    definition,
    version,
    ...(saved === undefined ? {} : { saved }),
  };
}

function linked(
  dispatched: Effect.Effect<Outcome, never, DispatcherServices>,
): Effect.Effect<Outcome, never, DispatcherServices> {
  return dispatched.pipe(Effect.provideService(StudioLinks, pageOf));
}

function asDispatched(
  dispatched: Effect.Effect<Outcome, never, DispatcherServices>,
): Effect.Effect<Outcome, never, DispatcherServices> {
  return dispatched;
}

const studioIn = Schema.decodeUnknownOption(
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Struct({ studio: Schema.String }) }),
);

function studioOf(outcome: Outcome): string | undefined {
  return Option.getOrUndefined(Option.map(studioIn(outcome), ({ output }) => output.studio));
}

const definitionIdIn = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Struct({ definition_id: Schema.String }) }),
);

interface SavedAndRun {
  readonly definition: string;
  readonly links: readonly (string | undefined)[];
}

async function savedAndRun(served: typeof linked): Promise<SavedAndRun> {
  const { dispatch, run } = harness();
  const created = await run(
    served(
      dispatch(
        createDefinitionInStudioPages,
        toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' }),
      ),
    ),
  );
  const updated = await run(
    served(
      dispatch(updateDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' })),
    ),
  );
  const unchanged = await run(
    served(
      dispatch(updateDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' })),
    ),
  );
  const ran = await run(
    served(dispatch(runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', run_id: runId }))),
  );
  return {
    definition: definitionIdIn(created).output.definition_id,
    links: [created, updated, unchanged, ran].map((outcome) => studioOf(outcome)),
  };
}

const decodeDetails = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.JsonObject));

function detailing(type: string): Capability {
  return defineCapability({
    type,
    title: type,
    guide: { name: type },
    noun: { one: type, other: `${type}s` },
    describeOutput: () => 'It answered.',
    mediaType: 'application/json',
    parse: (source: string) => Effect.orDie(decodeDetails(source)),
    summarize: (details) => ({ details }),
    run: () => Effect.succeed({ output: null, record: {} }),
  });
}

const TitledSchema = Schema.Struct({ title: Schema.optionalKey(Schema.String) });

const decodeTitled = Schema.decodeUnknownEffect(Schema.fromJsonString(TitledSchema));

const titling = defineCapability({
  type: 'workflow',
  title: 'workflow',
  guide: { name: 'workflow' },
  noun: { one: 'workflow', other: 'workflows' },
  describeOutput: () => 'It answered.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodeTitled(source)),
  summarize: ({ title }: typeof TitledSchema.Type) => (title === undefined ? {} : { title }),
  run: () => Effect.succeed({ output: null, record: {} }),
});

const {
  createDefinition: createTitled,
  getDefinition: getTitled,
  listDefinitions: listTitled,
} = definitionOperationsFor([titling]);

const {
  createDefinition: createDefinitionInUsedBy,
  getDefinition,
  listDefinitions: listDefinitionsInUsedBy,
  retireDefinition: retireDefinitionInUsedBy,
  updateDefinition: updateDefinitionInUsedBy,
} = definitionOperationsFor([probe().capability, detailing('workflow')]);

const plain = { type: 'probe', name: 'plain' };

function checkingPlain(name: string, ...steps: readonly number[]) {
  return {
    type: 'workflow',
    name,
    source: JSON.stringify({
      calls: [{ ...plain, steps: steps.map((number) => ({ number, name: `check-${number}` })) }],
    }),
  };
}

const weeklyReview = {
  type: 'workflow',
  name: 'weekly-review',
  relation: 'calls',
  steps: [
    { number: 1, name: 'check-1' },
    { number: 3, name: 'check-3' },
  ],
};

describe('list_definitions', () => {
  it('lists nothing for a capability without definitions', async () => {
    expect(await harness().call(listDefinitions, toAlpha(acmeAdmin, { type: 'echo' }))).toEqual({
      status: 'succeeded',
      output: { definitions: [] },
    });
  });

  it('lists the active definitions of the capability sorted by name, without their documents', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();

    expect(await call(listDefinitions, toAlpha(acmeAdmin, { type: 'probe' }))).toStrictEqual({
      status: 'succeeded',
      output: { definitions: [listed('alpha'), listed('gamma')] },
    });
    expect(await call(listDefinitions, toAlpha(acmeAdmin, { type: 'echo' }))).toMatchObject({
      output: { definitions: [{ type: 'echo', name: 'delta', media_type: 'application/json' }] },
    });
  });

  it('rejects a type the server does not run', async () => {
    expect(await harness().call(listDefinitions, toAlpha(acmeAdmin, { type: 'reasoning' }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ pointer: '/type', detail: someWords }],
    });
  });
});

describe('the title of a listed definition', () => {
  it('is the title its document gives, the one get_definition answers, and left out where its document gives none', async () => {
    const { call } = harness();
    const title = 'Weekly review';
    await call(
      createTitled,
      toAlpha(acmeAdmin, { type: 'workflow', name: 'weekly-review', source: JSON.stringify({ title }) }),
    );
    await call(createTitled, toAlpha(acmeAdmin, { type: 'workflow', name: 'untitled', source: '{}' }));

    const listedNow = await call(listTitled, toAlpha(acmeAdmin, { type: 'workflow' }));
    const read = await call(getTitled, toAlpha(acmeAdmin, { type: 'workflow', name: 'weekly-review' }));

    expect(listedNow).toMatchObject({
      status: 'succeeded',
      output: { definitions: [{ name: 'untitled' }, { name: 'weekly-review', title }] },
    });
    expect(listedNow).not.toHaveProperty('output.definitions.0.title');
    expect(read).toMatchObject({ status: 'succeeded', output: { title } });
  });
});

describe('include_retired', () => {
  it('lists the retired definitions too when true in JSON', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();
    const listing = (input: object) => call(listDefinitions, toAlpha(acmeAdmin, { type: 'probe', ...input }));

    expect(await listing({ include_retired: true })).toMatchObject(retiredToo);
    expect(await listing({ include_retired: false })).toMatchObject(activeOnly);
    expect(await listing({ include_retired: 'true' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/include_retired', detail: 'Expected boolean' }],
    });
  });

  it('lists the retired definitions too when true in a query string', async () => {
    const { call } = await withGammaAlphaAndRetiredBeta();
    const listing = (input: object) =>
      call(listDefinitions, asQueryString(toAlpha(acmeAdmin, { type: 'probe', ...input })));

    expect(await listing({ include_retired: 'true' })).toMatchObject(retiredToo);
    expect(await listing({ include_retired: 'false' })).toMatchObject(activeOnly);
    expect(await listing({})).toMatchObject(activeOnly);
    expect(await listing({ include_retired: 'yes' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/include_retired' }],
    });
  });

  it('and capability are the only fields list_definitions knows', async () => {
    expect(
      await harness().call(listDefinitions, toAlpha(acmeAdmin, { type: 'probe', status: 'retired' })),
    ).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/status', detail: 'Expected no excess property' }],
    });
  });
});

describe('the pages in Studio of what a playbook saves and runs', () => {
  it("are a definition's page by the id it was created with, at its version, saying whether it was created or updated and nothing where an update changed nothing, and a run's page", async () => {
    const { definition, links } = await savedAndRun(linked);

    expect(links).toEqual([
      pageOf(greetAt(definition, 1, 'created')),
      pageOf(greetAt(definition, 2, 'updated')),
      pageOf(greetAt(definition, 2)),
      pageOf({ kind: 'run', playbook: 'alpha', run: runId }),
    ]);
  });

  it("are left out where the server serving the call does not know Studio's address", async () => {
    expect((await savedAndRun(asDispatched)).links).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('the definitions get_definition says use a definition', () => {
  it('are the active ones of its playbook, each with its relation, a workflow with the steps that call it', async () => {
    const { call } = harness();
    await call(createDefinitionInUsedBy, toAlpha(acmeAdmin, { ...plain, source: 'x' }));
    await call(createDefinitionInUsedBy, toAlpha(acmeAdmin, checkingPlain('weekly-review', 1, 3)));
    await call(createDefinitionInUsedBy, toAlpha(acmeAdmin, checkingPlain('stale', 2)));
    await call(retireDefinitionInUsedBy, toAlpha(acmeAdmin, { type: 'workflow', name: 'stale' }));
    await call(createDefinitionInUsedBy, toPlaybook('acme', 'beta')(acmeAdmin, checkingPlain('elsewhere', 1)));

    expect(await call(getDefinition, toAlpha(acmeAdmin, plain))).toMatchObject({
      status: 'succeeded',
      output: {
        used_by: [weeklyReview],
      },
    });
  });

  it('are left out when none uses it, and not listed by list_definitions', async () => {
    const { call } = harness();
    await call(createDefinitionInUsedBy, toAlpha(acmeAdmin, { ...plain, source: 'x' }));
    await call(createDefinitionInUsedBy, toAlpha(acmeAdmin, checkingPlain('weekly-review', 1, 3)));

    expect(
      await call(getDefinition, toAlpha(acmeAdmin, { type: 'workflow', name: 'weekly-review' })),
    ).not.toHaveProperty('output.used_by');
    expect(await call(listDefinitionsInUsedBy, toAlpha(acmeAdmin, { type: 'probe' }))).not.toHaveProperty(
      'output.definitions.0.used_by',
    );
  });
});

describe('the definitions a saved definition is answered with as using it', () => {
  it('are those saved before it, on create, on update and on retire alike', async () => {
    const { call } = harness();
    await call(createDefinitionInUsedBy, toAlpha(acmeAdmin, checkingPlain('weekly-review', 1, 3)));
    const created = await call(createDefinitionInUsedBy, toAlpha(acmeAdmin, { ...plain, source: 'x' }));
    const updated = await call(updateDefinitionInUsedBy, toAlpha(acmeAdmin, { ...plain, source: 'y' }));
    const retired = await call(retireDefinitionInUsedBy, toAlpha(acmeAdmin, plain));

    expect([created, updated, retired]).toMatchObject([
      { status: 'succeeded', output: { version: 1, used_by: [weeklyReview] } },
      { status: 'succeeded', output: { version: 2, used_by: [weeklyReview] } },
      { status: 'succeeded', output: { status: 'retired', used_by: [weeklyReview] } },
    ]);
  });
});
