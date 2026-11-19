import type { Ledger } from '@on.auto/operations';
import { Effect, type Schema } from 'effect';

import { loadRegistry } from '../operations/registry-access.ts';
import type { DefinitionCommand, DefinitionCommandData } from '../registry/definition-commands.ts';
import type { DefinitionContent } from '../registry/definition-events.ts';
import type { DefinitionRegistry, RegisteredDefinition } from '../registry/definition-registry.ts';
import { definitionVersionIn, type DefinitionVersionAddress } from '../registry/definition-versions.ts';
import { renamedInTurn, renamedOn, type Renamed } from '../testing/renaming.ts';
import { decidedIn, inPlaybookOf } from './in-the-playbook.ts';

type TypedCommand =
  | { readonly type: string; readonly command: DefinitionCommand }
  | { readonly type: string; readonly renamed: Renamed; readonly at: string };

export const aReader = { id: 'person_reader', name: 'A reader' };

const someone = aReader;

function randomOf(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

type Pick = <A>(choices: readonly [A, ...A[]]) => A;

type Uses = readonly [NamedUse, ...NamedUse[]];

interface NamedUse {
  readonly type: string;
  readonly name: string;
}

type Part = Partial<DefinitionContent>;

const servedGoal = 'kept-going';

interface DeclaredDetails {
  readonly shape?: string;
  readonly calls?: Schema.Json;
  readonly reads?: Schema.Json;
  readonly contributes?: Schema.Json;
}

function contributesOf(step: number): DeclaredDetails {
  const declared: readonly [DeclaredDetails, ...DeclaredDetails[]] = [
    {},
    { contributes: [{ goal: servedGoal, purpose: `Serves the goal from step ${step}` }] },
    {
      contributes: [
        { goal: servedGoal, purpose: `Measures the goal from step ${step}`, measures: '/sum', final: true, extra: 1 },
      ],
    },
    { contributes: 'not a list of contributions' },
  ];
  const chosen = step % declared.length;
  return declared.reduce((kept, each, at) => (at === chosen ? each : kept), declared[0]);
}

function detailsOf(pick: Pick, step: number, uses: Uses): Part {
  const [called, read] = [pick(uses), pick(uses)];
  const calls = { type: called.type, name: called.name };
  const reads = { type: read.type, name: read.name };
  const declared = pick<DeclaredDetails>([
    {},
    { shape: 'table' },
    {
      calls: [
        { ...calls, steps: [{ number: step, name: `step ${step}` }] },
        { ...calls, steps: [] },
      ],
    },
    { calls: [{ ...calls, steps: [] }], reads: [reads, reads] },
  ]);
  const details = { ...declared, ...contributesOf(step) };
  return Object.keys(details).length === 0 ? {} : { details };
}

function contentOf(pick: Pick, step: number, uses: Uses): DefinitionContent {
  return {
    source: `document ${step} ${pick(['', 'with more'])}`,
    ...pick<Part>([{}, { overview: `overview ${step}` }]),
    ...pick<Part>([{}, { diagram: 'none' }]),
    ...pick<Part>([{}, { description: `does ${step}` }]),
    ...pick<Part>([{}, { input_schema: { type: 'object', step } }]),
    ...pick<Part>([{}, { output_schema: { type: 'object' } }]),
    ...pick<Part>([{}, { warnings: [] }, { warnings: [`warned ${step}`] }]),
    ...pick<Part>([{}, { triggers: [{ kind: 'every', reference: '/every', milliseconds: 60_000 }] }]),
    ...pick<Part>([{}, { page: null }]),
    ...detailsOf(pick, step, uses),
  };
}

function commandOf(pick: Pick, step: number, uses: Uses) {
  const { name } = pick(uses);
  const commands: readonly [DefinitionCommandData, ...DefinitionCommandData[]] = [
    {
      type: 'create',
      name,
      content: contentOf(pick, step, uses),
      created_by: someone,
      definition_id: `made-at-step-${step}`,
    },
    { type: 'update', name, content: contentOf(pick, step, uses) },
    { type: 'update', name, content: contentOf(pick, step, uses) },
    { type: 'pause', name, paused_by: someone, ...pick([{}, { reason: `paused at ${step}` }]) },
    { type: 'resume', name },
    { type: 'retire', name },
    { type: 'restore', name, restored_by: someone },
  ];
  return pick(commands);
}

const renamedEvery = 8;

function renamedAt(type: string, step: number, at: string): TypedCommand {
  return { type, renamed: renamedInTurn(type, step), at };
}

function generatedCommands(
  seed: number,
  steps: number,
  types: readonly [string, ...string[]],
): readonly TypedCommand[] {
  const random = randomOf(seed);
  const pick: Pick = (choices) => {
    const chosen = Math.floor(random() * choices.length);
    return choices.reduce((kept, choice, at) => (at === chosen ? choice : kept), choices[0]);
  };
  const [first, ...others] = types;
  const uses: Uses = [
    { type: first, name: 'first' },
    ...named(first).slice(1),
    ...others.flatMap((type) => named(type)),
  ];
  return Array.from({ length: steps }, (_, step): readonly TypedCommand[] => {
    const { type } = pick(uses);
    const at = new Date(Date.UTC(2026, 10, 1, 9, step)).toISOString();
    const command = { type, command: { ...commandOf(pick, step, uses), by: someone.id, at } };
    return step % renamedEvery === renamedEvery - 1 ? [command, renamedAt(type, step, at)] : [command];
  }).flat();
}

const alpha = { org: 'acme', playbook: 'alpha' };

function appliedTo(ledger: Ledger['Service'], commands: readonly TypedCommand[]): Effect.Effect<void> {
  return Effect.forEach(
    commands,
    (step) =>
      'renamed' in step
        ? renamedOn(ledger, alpha, step.renamed, step.at)
        : decidedIn(ledger, alpha, step.type, step.command),
    { discard: true },
  );
}

function named(type: string): readonly NamedUse[] {
  return ['first', 'second', 'third-one'].map((name) => ({ type, name }));
}

export function registriesIn(
  ledger: Ledger['Service'],
  types: readonly string[],
): Effect.Effect<ReadonlyMap<string, DefinitionRegistry>> {
  return Effect.map(
    Effect.forEach(types, (type) =>
      Effect.map(inPlaybookOf(ledger, alpha, loadRegistry(type)), (registry): readonly [string, DefinitionRegistry] => [
        type,
        registry,
      ]),
    ),
    (loaded: readonly (readonly [string, DefinitionRegistry])[]) => new Map(loaded),
  );
}

function savedVersionsOf({ version }: RegisteredDefinition): readonly number[] {
  return Array.from({ length: version }, (_, at) => at + 1);
}

export function warningsSavedWith({ warnings = [] }: RegisteredDefinition): readonly string[] {
  return warnings;
}

export function foldedVersionIn(ledger: Ledger['Service'], address: DefinitionVersionAddress) {
  return Effect.map(definitionVersionIn(ledger, { org: 'acme', playbook: 'alpha' }, address), (found) => [
    found?.source,
    found?.stripped,
    found?.putInPlaceBy,
  ]);
}

export async function aGeneratedHistory(
  ledger: Ledger['Service'],
  seed: number,
  types: readonly [string, ...string[]],
): Promise<void> {
  await Effect.runPromise(appliedTo(ledger, generatedCommands(seed, 160, types)));
}

export interface TypedDefinition {
  readonly type: string;
  readonly registered: RegisteredDefinition;
}

export async function definitionsIn(
  ledger: Ledger['Service'],
  types: readonly string[],
): Promise<readonly TypedDefinition[]> {
  const registries = await Effect.runPromise(registriesIn(ledger, types));
  return [...registries].flatMap(([type, registry]: readonly [string, DefinitionRegistry]) =>
    [...registry.values()].map((registered): TypedDefinition => ({ type, registered })),
  );
}

export interface SavedVersion {
  readonly type: string;
  readonly name: string;
  readonly version: number;
}

export function savedVersionsIn(definitions: readonly TypedDefinition[]): readonly SavedVersion[] {
  return definitions.flatMap(({ type, registered }) =>
    savedVersionsOf(registered).map((version): SavedVersion => ({ type, name: registered.name, version })),
  );
}

export interface UsedDefinition {
  readonly type: string;
  readonly name: string;
}

export function namesOf(types: readonly string[]): readonly UsedDefinition[] {
  return types.flatMap((type) => ['first', 'second', 'third-one'].map((name): UsedDefinition => ({ type, name })));
}

const savedAt = '2026-11-11T09:00:00.000Z';

export function executedIn(
  ledger: Ledger['Service'],
  type: string,
  command: DefinitionCommandData,
  playbook = 'alpha',
): Promise<void> {
  return Effect.runPromise(
    decidedIn(ledger, { org: 'acme', playbook }, type, { ...command, by: someone.id, at: savedAt }),
  );
}

export function createdWith(
  ledger: Ledger['Service'],
  name: string,
  content: DefinitionContent,
  playbook = 'alpha',
): Promise<void> {
  return executedIn(
    ledger,
    'echo',
    { type: 'create', name, content, created_by: someone, definition_id: nextIdOf(playbook, name) },
    playbook,
  );
}

export function createdInTurn(
  ledger: Ledger['Service'],
  names: readonly string[],
  details: Schema.JsonObject,
): Promise<void> {
  return Effect.runPromise(
    Effect.forEach(
      names,
      (name) =>
        Effect.promise(() =>
          createdWith(ledger, name, {
            source: JSON.stringify({ greeting: name }),
            details,
          }),
        ),
      { discard: true },
    ),
  );
}

const created = { count: 0 };

function nextIdOf(playbook: string, name: string): string {
  created.count += 1;
  return `${playbook}-${name}-${String(created.count)}`;
}

export function createdIn(ledger: Ledger['Service'], name: string, playbook = 'alpha'): Promise<void> {
  return createdWith(ledger, name, { source: JSON.stringify({ greeting: name }) }, playbook);
}
