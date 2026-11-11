import { parseArgs } from 'node:util';

import type { ServedToAnAgent } from '@on.auto/server/served-to-an-agent';
import { Schema } from 'effect';

import { askedEachModel, type Asking } from './asking.ts';
import type { Ask, Model } from './models.ts';
import { BriefSchema, ProfileSchema, promptOf, type Brief, type Person, type Profile } from './prompts.ts';
import { appendRow, resultOf, rowsIn, tableOf, type Row } from './record.ts';
import {
  answersIn,
  digestOf,
  jsonIn,
  ModelRunSchema,
  modelRunPath,
  modelsAnsweredIn,
  promptPath,
  RunSchema,
  runPath,
  written,
  type Run,
} from './run-folder.ts';
import { required, shownOf, textsSent } from './shown.ts';

export const BriefsSchema = Schema.Struct({ briefs: Schema.Array(BriefSchema), search_answer: Schema.Unknown });

export interface Parts {
  readonly served: () => Promise<ServedToAnAgent>;
  readonly ask: Ask;
  readonly models: readonly Model[];
  readonly versionOf: (model: Model) => string;
  readonly now: () => Date;
  readonly briefs: typeof BriefsSchema.Type;
  readonly record: string;
  readonly print: (line: string) => void;
}

function briefOf({ briefs }: Parts): (id: string) => Brief {
  return (id) =>
    required(
      briefs.briefs.find((brief) => brief.id === id),
      `There is no brief ${id}`,
    );
}

function briefsChosen(parts: Parts, ids: readonly string[], heldOut: boolean): readonly Brief[] {
  return ids.map((id) => {
    const brief = briefOf(parts)(id);
    if (brief.held_out && !heldOut) {
      throw new Error(`The brief ${id} is held out: it runs only on a finished change, given --held-out`);
    }
    return brief;
  });
}

const isAProfile = Schema.is(ProfileSchema);

function profileNamed(name: string): Profile {
  if (!isAProfile(name)) {
    throw new Error(`There is no profile ${name}: a profile is listing, first-512 or names`);
  }
  return name;
}

interface PromptsAsked {
  readonly folder: string;
  readonly profile: string;
  readonly briefs: readonly string[];
  readonly person: Person;
  readonly heldOut: boolean;
}

async function writePrompts(parts: Parts, { folder, profile, briefs, person, heldOut }: PromptsAsked): Promise<void> {
  const chosen = briefsChosen(parts, briefs, heldOut);
  const asked = profileNamed(profile);
  const { surface } = await parts.served();
  const shown = shownOf(surface, parts.briefs.search_answer);
  const prompts: readonly { readonly id: string; readonly prompt: string }[] = chosen.map((brief) => ({
    id: brief.id,
    prompt: promptOf(shown, { profile: asked }, brief, person),
  }));
  for (const { id, prompt } of prompts) {
    written(promptPath(folder, id), prompt);
    parts.print(`${id}: ${Buffer.byteLength(prompt)} bytes`);
  }
  const run: Run = {
    profile: asked,
    briefs: prompts.map(({ id }) => id),
    server_name: person.serverName,
    starter: person.starter,
    texts: textsSent(
      surface,
      shown,
      prompts.map(({ prompt }) => prompt),
    ),
    prompts: Object.fromEntries(prompts.map(({ id, prompt }) => [id, digestOf(prompt)])),
    shown,
  };
  written(runPath(folder), run);
}

async function askModels(parts: Parts, folder: string, named: readonly string[]): Promise<void> {
  const run = jsonIn(runPath(folder), RunSchema);
  const models = named.length === 0 ? parts.models : parts.models.filter(({ name }) => named.includes(name));
  const asking: Asking = { ask: parts.ask, versionOf: parts.versionOf, briefOf: briefOf(parts), print: parts.print };
  await askedEachModel(asking, { folder, run }, models);
}

function resultsIn(parts: Parts, folder: string, run: Run): Row['results'] {
  return Object.fromEntries(
    modelsAnsweredIn(folder).map((model) => {
      const results = run.briefs
        .map((id) => [id, answersIn(folder, model, id)] as const)
        .filter(([, answers]) => answers.length > 0)
        .map(([id, answers]) => [id, resultOf(briefOf(parts)(id).shape, answers)] as const);
      return [model, Object.fromEntries(results)];
    }),
  );
}

function recordRun(parts: Parts, folder: string, label: string, note: string | undefined): void {
  const run = jsonIn(runPath(folder), RunSchema);
  const results = resultsIn(parts, folder, run);
  const row: Row = {
    label,
    date: parts.now().toISOString(),
    profile: run.profile,
    server_name: run.server_name,
    starter: run.starter,
    models: Object.fromEntries(
      Object.keys(results).map((model) => [model, jsonIn(modelRunPath(folder, model), ModelRunSchema)]),
    ),
    texts: run.texts,
    prompts: run.prompts,
    results,
    ...(note === undefined ? {} : { note }),
  };
  appendRow(parts.record, row);
  parts.print(tableOf(row));
}

function printTables(parts: Parts, labels: readonly string[]): void {
  for (const row of rowsIn(parts.record).filter(({ label }) => labels.length === 0 || labels.includes(label))) {
    parts.print(tableOf(row));
  }
}

const usage = [
  'Usage:',
  '  pnpm behavioural-check prompts FOLDER --profile listing|first-512|names --briefs J1,C1 --server-name NAME --starter SENTENCE [--held-out]',
  '  pnpm behavioural-check run FOLDER [MODEL ...]',
  '  pnpm behavioural-check record FOLDER --label LABEL [--note NOTE]',
  '  pnpm behavioural-check table [LABEL ...]',
].join('\n');

const options = {
  profile: { type: 'string' },
  briefs: { type: 'string' },
  'server-name': { type: 'string' },
  starter: { type: 'string' },
  'held-out': { type: 'boolean', default: false },
  label: { type: 'string' },
  note: { type: 'string' },
} as const;

function given(value: string | undefined): string {
  return required(value, usage);
}

export async function runBehaviouralCheck(commandArguments: readonly string[], parts: Parts): Promise<void> {
  const { values, positionals } = parseArgs({ args: [...commandArguments], options, allowPositionals: true });
  const [command, folder, ...rest] = positionals;
  if (command === 'prompts') {
    await writePrompts(parts, {
      folder: given(folder),
      profile: given(values.profile),
      briefs: given(values.briefs).split(','),
      person: { serverName: given(values['server-name']), starter: given(values.starter) },
      heldOut: values['held-out'],
    });
  } else if (command === 'run') {
    await askModels(parts, given(folder), rest);
  } else if (command === 'record') {
    recordRun(parts, given(folder), given(values.label), values.note);
  } else if (command === 'table') {
    printTables(parts, positionals.slice(1));
  } else {
    throw new Error(usage);
  }
}
