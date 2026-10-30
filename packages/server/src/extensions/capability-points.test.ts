import { defineCapability } from '@on.auto/definitions';
import { answerInteraction } from '@on.auto/interaction';
import { datasetsProvidedOn } from '@on.auto/prediction';
import type { CapabilityPorts } from '@on.auto/workflow-host';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { configured } from '../testing/extensions/scratch-packages.ts';
import { sharedWorkerPool } from '../testing/servers/worker-pools.ts';
import {
  predictionCapabilityFilled,
  predictionCapabilityOf,
  type FilledPoint,
  type PortsOfTheServer,
} from './capability-points.ts';
import { loadedExtensions, type InstalledPackages } from './extension-loading.ts';

const pool = sharedWorkerPool();

const noRows = () => Effect.succeed([]);

const ports: PortsOfTheServer = {
  database: { read: noRows, write: noRows, transaction: noRows, readConsistently: (reads) => reads(noRows) },
  pool,
  features: { includes: () => Effect.succeed(false), refusal: () => Effect.die('No feature is asked') },
  mostFunctions: 7,
  triesBeforeStall: 3,
};

function forecastsOf({ settings, mostFunctions }: CapabilityPorts) {
  return defineCapability({
    type: 'prediction',
    title: settings.get('TITLE') ?? 'Forecasts',
    guide: { name: 'prediction-function' },
    noun: { one: 'prediction function', other: 'prediction functions' },
    describeOutput: () => 'The extension answered.',
    mediaType: 'text/markdown',
    parse: (source) => Effect.succeed(source),
    summarize: () => ({}),
    run: () => Effect.succeed({ output: null, record: {} }),
    mostActive: mostFunctions * 10,
  });
}

function wholeCapability(): Readonly<Record<string, unknown>> {
  return { ...forecastsOf({ ...ports, settings: new Map() }) };
}

type Implementation = (given: CapabilityPorts) => unknown;

type Filling = readonly [name: string, implementation: unknown, contract?: number];

function packagesHolding(fillings: readonly Filling[]): InstalledPackages {
  const modules = new Map(
    fillings.map(([name, implementation, contract = 1]) => [
      name,
      {
        manifest: {
          name,
          version: '1.0.0',
          provides: [{ point: 'capability/prediction', contract, implementation }],
        },
      },
    ]),
  );
  return { imported: (name) => Promise.resolve(modules.get(name)), directoryOf: () => '/nowhere' };
}

const ownSettings: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map([
  ['@acme/forecasts', new Map([['TITLE', 'Acme forecasts']])],
]);

async function predictionFilledBy(...fillings: readonly Filling[]): Promise<FilledPoint> {
  const listed = configured(...fillings.map(([name]) => name));
  const { provided } = await loadedExtensions(listed, [predictionCapabilityFilled], packagesHolding(fillings));
  return predictionCapabilityOf(provided, (extension) => ownSettings.get(extension) ?? new Map());
}

function makingOnly(capability: unknown): Implementation {
  return () => ({ capability });
}

function withMember(member: string, value: unknown): Readonly<Record<string, unknown>> {
  return { ...wholeCapability(), [member]: value };
}

function without(whole: object, member: string): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(whole).filter(([key]: readonly [string, unknown]) => key !== member));
}

function withoutMember(member: string): Readonly<Record<string, unknown>> {
  return without(wholeCapability(), member);
}

const [datasets] = datasetsProvidedOn(ports).folders;

const datasetsFolder: unknown = datasets?.((folder): unknown => folder);

function providing(provided: Readonly<Record<string, unknown>>): Implementation {
  return () => ({ capability: wholeCapability(), ...provided });
}

function openedAs(folder: unknown): unknown {
  return (use: (opened: unknown) => unknown) => use(folder);
}

const refusalsOfWhatItMakes: readonly (readonly [string, Implementation, string])[] = [
  [
    'cannot make its capability',
    () => {
      throw new Error('The forecasts are not ready\nat line 2');
    },
    'it could not make its capability for capability/prediction: The forecasts are not ready',
  ],
  [
    'makes a capability of another type, naming it',
    makingOnly(withMember('type', 'reasoning')),
    'it fills capability/prediction with a capability of the type reasoning, and the point takes one of the type prediction',
  ],
  ['answers no object', () => 'forecasts', 'what it makes is not an object'],
  [
    'answers a capability alone, outside the shape it provides',
    () => wholeCapability(),
    'what it makes has no capability',
  ],
  ['makes a capability that lacks a member', makingOnly(withoutMember('facts')), 'its capability has no facts'],
  [
    'makes a capability whose function is none',
    makingOnly(withMember('prepare', 3)),
    'its capability.prepare is not a function',
  ],
  [
    'makes a capability whose number is none',
    makingOnly(withMember('mostActive', '7')),
    'its capability.mostActive is not a number',
  ],
  [
    'makes a capability whose flag is none',
    makingOnly(withMember('resumes', 'no')),
    'its capability.resumes is not a boolean',
  ],
  [
    'makes a capability whose words are none',
    makingOnly(withMember('noun', { one: 'forecast', other: 2 })),
    'its capability.noun.other is not text',
  ],
  [
    'makes a capability whose list is none',
    makingOnly(withMember('facts', { onRuns: [], streams: {} })),
    'its capability.facts.streams is not a list',
  ],
  [
    'makes a capability whose members are not its own',
    makingOnly(Object.create(wholeCapability())),
    'its capability is not a plain object of its members, as defineCapability makes one',
  ],
  [
    'makes a capability whose part is no object',
    makingOnly(withMember('runWords', 'deferred')),
    'its capability.runWords is not an object',
  ],
  ['provides a folder that is no folder', providing({ folders: [3] }), 'its folders[0] is not a function'],
  [
    'provides a folder that cannot be opened',
    providing({
      folders: [
        () => {
          throw new Error('The tables are not ready');
        },
      ],
    }),
    'its folders[0] could not be opened: The tables are not ready',
  ],
  [
    'provides a folder without its fold',
    providing({ folders: [openedAs(without(new Object(datasetsFolder), 'fold'))] }),
    'its folders[0] has no fold',
  ],
  [
    'provides a folder whose tables are not statements',
    providing({
      folders: [
        openedAs({ ...without(new Object(datasetsFolder), 'tables'), tables: ['CREATE TABLE forecasts (id TEXT)'] }),
      ],
    }),
    'its folders[0].tables[0] is not an object',
  ],
  [
    'provides an operation that does not run',
    providing({ operations: [{ registration: without(answerInteraction.registration, 'run') }] }),
    'its operations[0].registration has no run',
  ],
  [
    'provides an operation served over HTTP alone',
    providing({
      operations: [
        {
          registration: {
            ...without(answerInteraction.registration, 'servedOverHttpAlone'),
            servedOverHttpAlone: 'json',
          },
        },
      ],
    }),
    'its operations[0].registration.servedOverHttpAlone is not absent, since a playbook operation is a tool too',
  ],
  [
    'provides due work that is not due work',
    () => ({ capability: wholeCapability(), dueWork: [{ name: 'forecasts', nextDueAt: () => null }] }),
    'its dueWork[0] has no due',
  ],
];

describe('the prediction capability of a runtime', () => {
  it('is the forecaster of the release, with its datasets, while no extension fills capability/prediction', async () => {
    const { capability, folders } = (await predictionFilledBy())(ports);

    expect([capability.title, capability.guide, capability.mostActive, folders?.length]).toEqual([
      'Prediction',
      { name: 'prediction-function' },
      7,
      1,
    ]);
  });

  it('takes the folders and the operations an extension provides with its capability, whole', async () => {
    const makePrediction = await predictionFilledBy([
      '@acme/forecasts',
      providing({ folders: [openedAs(datasetsFolder)], operations: [answerInteraction] }),
    ]);

    const { folders = [], operations } = makePrediction(ports);

    expect([folders.length, operations]).toEqual([1, [answerInteraction]]);
  });

  it('is the capability an extension filling it at contract 1 makes from the ports and its own settings, kept to the functions the runtime allows', async () => {
    const makePrediction = await predictionFilledBy([
      '@acme/forecasts',
      (given: CapabilityPorts) => ({ capability: forecastsOf(given) }),
    ]);

    const { capability, folders } = makePrediction(ports);

    expect([capability.title, capability.mostActive, folders]).toEqual(['Acme forecasts', 7, undefined]);
  });
});

describe('an extension filling capability/prediction that a runtime refuses, so that it does not start', () => {
  it.each<readonly [string, Filling, string]>([
    [
      'built against a contract other than the release’s',
      ['@acme/forecasts', makingOnly(wholeCapability()), 2],
      'The extension @acme/forecasts is refused: it provides capability/prediction built against contract 2, and this runtime accepts contract 1',
    ],
    [
      'whose implementation makes nothing',
      ['@acme/forecasts', { capability: wholeCapability() }],
      'The extension @acme/forecasts is refused: its implementation of capability/prediction is malformed: Expected a function that makes the capability from the ports the runtime hands it',
    ],
  ])('names the extension and why, for one %s', async (_case, filling, refusal) => {
    await expect(predictionFilledBy(filling)).rejects.toThrow(refusal);
  });

  it('names both extensions when two fill it', async () => {
    await expect(
      predictionFilledBy(
        ['@acme/forecasts', makingOnly(wholeCapability())],
        ['@globex/forecasts', makingOnly(wholeCapability())],
      ),
    ).rejects.toThrow(
      'The extensions @acme/forecasts and @globex/forecasts each fill capability/prediction, and one extension at most may fill it; keep one of them in extensions',
    );
  });

  it.each<readonly [string, Implementation, string]>(refusalsOfWhatItMakes)(
    'names the extension when what it fills the point with %s',
    async (_case, implementation, refusal) => {
      const makePrediction = await predictionFilledBy(['@acme/forecasts', implementation]);

      expect(() => makePrediction(ports)).toThrow(`The extension @acme/forecasts is refused: ${refusal}`);
    },
  );
});
