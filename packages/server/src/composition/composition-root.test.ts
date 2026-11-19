import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { textToKeep } from '@on.auto/content';
import { workflowFacts } from '@on.auto/coordination';
import { declaredFact, runOutcomeMapping } from '@on.auto/definitions';
import { renderTargetNames } from '@on.auto/interaction';
import { nudging } from '@on.auto/interaction/testing';
import { ledgerLayer } from '@on.auto/ledger/sqlite';
import { ledgerLayout, ledgerLayoutFloor } from '@on.auto/ledger/testing';
import { LicensedFeatures, licensedFeaturesOf } from '@on.auto/meter';
import {
  allPermissions,
  type CallerIdentity,
  factOf,
  factTypesOf,
  makeDispatcher,
  PlaybookRegistry,
  RunContextSchema,
} from '@on.auto/operations';
import {
  modulesReachedFrom,
  payloadReadsOf,
  recordedFactsUnder,
  remarkedContext,
  remarkFacts,
  RemarkFactSchema,
} from '@on.auto/operations/testing';
import { createPlaybook } from '@on.auto/playbooks';
import { providersShippedRoots, readProviders } from '@on.auto/providers';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Context, Effect, Layer, ManagedRuntime, Result, Schema, type SchemaAST } from 'effect';
import { describe, expect, it } from 'vitest';

import { unlicensed } from '../licensing/meter-layer.ts';
import { logsToStderr } from '../logging/log-formats.ts';
import { forecastChecked } from '../testing/extensions/declared-facts.ts';
import { memoryRuntime } from '../testing/records/memory-runtime.ts';
import { applicationLayer } from './application-layer.ts';
import { factsComposedOf } from './composed-facts.ts';
import { keptByTheLedgerWith } from './kept-by-the-ledger.ts';
import { keptProjections } from './kept-projections.ts';
import { factSchemasKnownWith, knownFactSchemas } from './known-facts.ts';
import { factsKnownWith } from './known-holders.ts';
import { release } from './release.ts';
import { runtimeLedger } from './runtime-ledger.ts';

const acmeAdmin: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

const statusOfAlpha = Effect.gen(function* () {
  const registry = yield* PlaybookRegistry;
  return yield* registry.status({ org: 'acme', playbook: 'alpha' });
});

const runsNothing = {
  run: () => Promise.reject(new Error('The facts are composed before anything runs')),
  dispose: () => Promise.resolve(),
  context: Context.empty(),
};

const sources = fileURLToPath(new URL('..', import.meta.url));

function awsClientsReachedFrom(module: string): readonly string[] {
  return modulesReachedFrom(sources, module).packages.filter((name) => name === '@on.auto/outbound/aws');
}

const entitled: ReadonlyMap<string, readonly string[]> = new Map([['acme', ['example-feature']]]);

function featuresOf(org: string): Effect.Effect<readonly string[]> {
  return Effect.succeed(entitled.get(org) ?? []);
}

const included = Effect.flatMap(Effect.service(LicensedFeatures), (features) =>
  Effect.all([
    features.includes({ org: 'acme', feature: 'example-feature' }),
    features.includes({ org: 'globex', feature: 'example-feature' }),
  ]),
);

const manifestOf = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ name: Schema.String, version: Schema.String })),
);

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

function typesOf(schemas: readonly { readonly ast: SchemaAST.AST }[]): readonly string[] {
  return [...new Set(schemas.flatMap((schema) => factTypesOf(schema)))].toSorted();
}

const BytesKeptSchema = factOf('bytes_kept', Schema.Struct({ sha256: Schema.String }), RunContextSchema, {
  content: { holds: ['/sha256'] },
});

const bytesKept = declaredFact('bytes_kept', BytesKeptSchema, ({ type, data }) => ({ type, summary: 'Kept.', data }));

const argumentsHeld = { holds: ['/arguments_sha256'] };

const resultHeld = { holds: ['/result_sha256'] };

const bothHeld = { holds: ['/arguments_sha256', '/result_sha256'] };

const documentKept = [
  { sha256: '/content/source_sha256', bytes: '/content/source_bytes' },
  { sha256: '/content/overview_sha256', bytes: '/content/overview_bytes' },
  { sha256: '/content/diagram_sha256', bytes: '/content/diagram_bytes' },
];

const runtimeFolder = fileURLToPath(new URL('../../../../', import.meta.url));

function recordedFixtures() {
  return recordedFactsUnder(runtimeFolder);
}

const tables = {
  projections: keptProjections,
  runOutcomes: runOutcomeMapping,
};

const alpha = { org: 'acme', playbook: 'alpha' };

const gamma = { org: 'globex', playbook: 'gamma' };

const repository = join(import.meta.dirname, '..', '..', '..', '..');

const fixtureOfARelease = /(?:^|\/)\d+\.\d+\.\d+\/(?<type>[a-z][a-z0-9_]*)\.json$/u;

function fixtureTypesUnder(group: string): readonly string[] {
  return readdirSync(join(repository, group)).flatMap((name) =>
    readdirSync(join(repository, group, name, 'src'), { recursive: true, encoding: 'utf8' }).flatMap(
      (path) => fixtureOfARelease.exec(path)?.groups?.['type'] ?? [],
    ),
  );
}

const repositoryContainerSources = fileURLToPath(new URL('../../../../', import.meta.url));

const dockerfile = readFileSync(join(repositoryContainerSources, 'packages/server/Dockerfile'), 'utf8');

const manifestOfContainerSources = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.String,
      dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
);

type Manifest = ReturnType<typeof manifestOfContainerSources>;

const workspace: ReadonlyMap<string, { readonly directory: string; readonly manifest: Manifest }> = new Map(
  ['packages', 'capabilities'].flatMap((group) =>
    readdirSync(join(repositoryContainerSources, group))
      .map((name) => join(group, name))
      .filter((directory) => existsSync(join(repositoryContainerSources, directory, 'package.json')))
      .map((directory): readonly [string, { readonly directory: string; readonly manifest: Manifest }] => {
        const manifest = manifestOfContainerSources(
          readFileSync(join(repositoryContainerSources, directory, 'package.json'), 'utf8'),
        );
        return [manifest.name, { directory, manifest }];
      }),
  ),
);

function workspaceDependenciesOf(name: string): readonly string[] {
  const dependencies = workspace.get(name)?.manifest.dependencies ?? {};
  return Object.entries(dependencies)
    .filter(([, specification]: readonly [string, string]) => specification.startsWith('workspace:'))
    .map(([dependency]: readonly [string, string]) => dependency);
}

function reachedFrom(name: string, reached: ReadonlySet<string> = new Set()): ReadonlySet<string> {
  if (reached.has(name)) {
    return reached;
  }
  return workspaceDependenciesOf(name).reduce<ReadonlySet<string>>(
    (known, dependency) => reachedFrom(dependency, known),
    new Set([...reached, name]),
  );
}

function directoryOf(name: string): string {
  const found = workspace.get(name);
  if (found === undefined) {
    throw new Error(`No workspace package is named ${name}`);
  }
  return found.directory;
}

const shippedDirectories = [...reachedFrom('@on.auto/server')].map((name) => directoryOf(name)).toSorted();

describe('the services the playbook operations run on', () => {
  it('are the only services at the top level of the runtime, beside Effect’s own', async () => {
    const runtime = ManagedRuntime.make(
      applicationLayer(ledgerLayer({ fileName: ':memory:' })).pipe(Layer.provideMerge(logsToStderr('json'))),
    );

    const keys = [...(await runtime.context()).mapUnsafe.keys()];
    await runtime.dispose();

    expect(keys.filter((key) => !key.startsWith('effect/')).toSorted()).toEqual([
      '@on.auto/definitions/LiveAttempts',
      '@on.auto/definitions/RunMeter',
      '@on.auto/ledger/LedgerChores',
      '@on.auto/ledger/LedgerConnection',
      '@on.auto/ledger/LedgerLog',
      '@on.auto/meter/LicensedFeatures',
      '@on.auto/meter/RuntimeLicense',
      '@on.auto/operations/IncidentReporter',
      '@on.auto/operations/Ledger',
      '@on.auto/operations/PayloadsShared',
      '@on.auto/operations/PlaybookRegistry',
    ]);
  });

  it('share one ledger, so the playbook registry finds a playbook the operations created', async () => {
    const runtime = ManagedRuntime.make(applicationLayer(ledgerLayer({ fileName: ':memory:' })));
    const created = makeDispatcher([]).dispatchToOrg(createPlaybook.registration, {
      caller: acmeAdmin,
      org: 'acme',
      input: { playbook: 'alpha', name: 'Alpha' },
      encoding: 'json',
    });

    const outcome = await runtime.runPromise(created);
    const status = await runtime.runPromise(statusOfAlpha);
    await runtime.dispose();

    expect({ outcome: outcome.status, status }).toEqual({ outcome: 'succeeded', status: 'active' });
  });
});

describe('the facts the server composes from its capabilities and the workflow’s, as it starts', () => {
  it('are refused, and the server does not start, when a fact or a stream kind is declared twice or a fact the playbook records itself, naming it and the capability', () => {
    const prodding = { ...nudging, type: 'prodding' };
    const claiming = {
      ...nudging,
      type: 'claiming',
      facts: { ...nudging.facts, onRuns: nudging.facts.onRuns.map((fact) => ({ ...fact, type: 'run_failed' })) },
    };
    const logging = { ...nudging, type: 'logging', facts: { onRuns: [], streams: workflowFacts.facts.streams } };

    expect(() => factsComposedOf(runsNothing, [nudging, prodding])).toThrow(
      'The fact nudge_sent is declared by the capabilities nudging and prodding, and one capability alone may declare it',
    );
    expect(() => factsComposedOf(runsNothing, [claiming])).toThrow(
      'The fact run_failed that the capability claiming declares is one the playbook records itself',
    );
    expect(() => factsComposedOf(runsNothing, [logging])).toThrow(
      'The stream kind run-logs is declared by the capabilities logging and workflow, and one capability alone may declare it',
    );
    expect(factsComposedOf(runsNothing, [nudging]).facts).toEqual({
      onRuns: nudging.facts.onRuns,
      streams: workflowFacts.facts.streams,
    });
  });
});

describe('the AWS clients of the outbound package', () => {
  it('are reached from neither module the server starts with, and load with the first client its settings name', () => {
    expect([
      ...awsClientsReachedFrom('lifecycle/run-server.ts'),
      ...awsClientsReachedFrom('composition/composition-root.ts'),
    ]).toEqual([]);
  });
});

describe('the features of the license a composition gives', () => {
  it('take the place of the meter’s', async () => {
    const given = licensedFeaturesOf(featuresOf);
    const runtime = ManagedRuntime.make(
      applicationLayer(ledgerLayer({ fileName: ':memory:' }), { ...unlicensed, features: given }),
    );

    const answered = await runtime.runPromise(included);
    await runtime.dispose();

    expect(answered).toEqual([true, false]);
  });
});

describe('release', () => {
  it('carries the name and the release version of the repository manifest, which names the product', () => {
    const manifest = manifestOf(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));

    expect(release).toEqual({ name: manifest.name, version: manifest.version });
    expect(release.name).toBe('@on.auto/runtime');
  });
});

describe('the render targets the shipped providers name', () => {
  it('are each a render target of the interaction capability', () => {
    const named = shipped.providers.map(({ entry }) => entry.renders).filter((target) => target !== undefined);

    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((target) => !renderTargetNames.some((name) => name === target))).toEqual([]);
  });
});

describe('the steps the server gives the ledger, from every package that owns a table in its database', () => {
  it('lead from the floor to the layout kept, one step for each number', () => {
    const numbers = Array.from(
      { length: ledgerLayout - ledgerLayoutFloor },
      (_, index) => ledgerLayoutFloor + index + 1,
    );

    expect(keptByTheLedgerWith([]).layoutSteps.map(({ layout }) => layout)).toEqual(numbers);
  });
});

describe('the fact schemas the server gives the ledger as it opens', () => {
  it('are the ones it composes and the schema of each fact a capability declares on runs, so a declared type is read at start', () => {
    expect(typesOf(factSchemasKnownWith([forecastChecked]))).toEqual(
      [...typesOf(knownFactSchemas), 'forecast_checked'].toSorted(),
    );
  });

  it('are the ones it composes alone where no capability declares a fact on runs, so no other type is read', () => {
    expect(factSchemasKnownWith([])).toEqual(knownFactSchemas);
  });
});

describe('the facts the server tells the ledger hold content', () => {
  it('are the saved versions of a definition that may keep its document, overview and diagram outside them, the facts of every call that keeps what it sent and what it was answered, the facts of a run that may keep its input, output, answer or the prompt its record holds outside it, the assets of generation functions, held until they expire, the record of each input a workflow applies, which names the values it keeps outside, and each fact a capability declares on runs that holds content', () => {
    const { factSchemas, holders } = factsKnownWith([forecastChecked, bytesKept]);

    expect(factSchemas).toEqual(factSchemasKnownWith([forecastChecked, bytesKept]));
    expect(Object.fromEntries(holders)).toEqual({
      definition_created: { payloads: documentKept },
      definition_updated: { payloads: documentKept },
      definition_restored: { payloads: documentKept },
      run_started: { payloads: [{ sha256: '/input_sha256', bytes: '/input_bytes' }] },
      run_succeeded: {
        payloads: [
          { sha256: '/output_sha256', bytes: '/output_bytes' },
          { sha256: '/record/prompt_sha256', bytes: '/record/prompt_bytes' },
        ],
      },
      request_answered: { payloads: [{ sha256: '/answer_sha256', bytes: '/answer_bytes' }] },
      tool_call_started: argumentsHeld,
      tool_call_answered: resultHeld,
      model_call_started: { holds: ['/messages_sha256'] },
      model_call_answered: { holds: ['/response_sha256'] },
      delivery_started: argumentsHeld,
      delivery_succeeded: resultHeld,
      delivery_failed: resultHeld,
      telling_started: argumentsHeld,
      telling_succeeded: resultHeld,
      telling_failed: resultHeld,
      replies_read: bothHeld,
      reading_failed: bothHeld,
      asset_kept: { holds: ['/sha256'] },
      asset_expired: { releases: 'all' },
      input_applied: {
        payloads: [
          { sha256: '/kept/*/sha256', bytes: '/kept/*/bytes' },
          { sha256: '/outputs/*/arguments_sha256', bytes: '/outputs/*/arguments_bytes' },
        ],
      },
      bytes_kept: { holds: ['/sha256'] },
    });
  });
});

describe('the tables the server keeps from facts', () => {
  it('have a recorded fact of every type they fold, so each type is checked against the payloads it may keep outside', () => {
    const recorded = new Set(recordedFixtures().map(({ type }) => type));
    const folded = [...keptProjections.flatMap(({ types }) => types), ...runOutcomeMapping.types];

    expect(folded.filter((type) => !recorded.has(type))).toEqual([]);
  });

  it('fold no value a fact may keep outside: every recorded fact folds to the same rows and keys with its payloads kept outside instead, so no fill of a table reads the content store', () => {
    expect(payloadReadsOf(tables, factsKnownWith([]).holders, recordedFixtures())).toEqual([]);
  });
});

describe("the ledger the server hands its capabilities, over the runtime's own", () => {
  it('reads the head of a content a playbook keeps, its size and type, and none for a playbook of another org', async () => {
    const runtime = await memoryRuntime();
    const { content } = runtimeLedger(runtime);
    const kept = await Effect.runPromise(content.put(alpha, textToKeep('{"lead":"lead-1"}', 'application/json')));
    const heads = await Effect.runPromise(
      Effect.all([content.getHead(alpha, kept.sha256), content.getHead(gamma, kept.sha256)]),
    );
    await runtime.dispose();

    expect(heads).toMatchObject([{ bytes: 17, mediaType: 'application/json' }, undefined]);
  });

  it('reads the one fact at a position of a stream, as the ledger reads it', async () => {
    const runtime = await memoryRuntime();
    const ledger = runtimeLedger(runtime);
    const remarks = 'playbook/acme/alpha/remarks/r1';
    await Effect.runPromise(ledger.execute(remarks, remarkFacts, [{ type: 'remark_made', data: { text: 'first' } }]));
    const read = await Effect.runPromise(ledger.factAt(remarks, 1, RemarkFactSchema));
    await runtime.dispose();

    expect(read).toEqual({ type: 'remark_made', data: { text: 'first' }, context: remarkedContext });
  });
});

describe('the fact types the server gives the ledger to read', () => {
  it('are every fact type a fixture keeps, so a fact any module of the server records is one it reads', () => {
    const factTypes = [
      ...new Set(knownFactSchemas.flatMap((schema: { readonly ast: SchemaAST.AST }) => factTypesOf(schema))),
    ].toSorted();
    const kept = [...new Set([...fixtureTypesUnder('packages'), ...fixtureTypesUnder('capabilities')])].toSorted();

    expect(factTypes).toEqual(kept);
    expect(factTypes).toHaveLength(94);
  });
});

describe('the image', () => {
  it('installs the manifest and copies the sources of every workspace package the server reaches', () => {
    const missingManifests = shippedDirectories.filter(
      (directory) => !dockerfile.includes(`COPY ${directory}/package.json ${directory}/\n`),
    );
    const missingSources = shippedDirectories.filter(
      (directory) => !dockerfile.includes(`COPY ${directory}/src ${directory}/src\n`),
    );
    expect(shippedDirectories.length).toBeGreaterThan(15);
    expect({ missingManifests, missingSources }).toEqual({ missingManifests: [], missingSources: [] });
  });
});
