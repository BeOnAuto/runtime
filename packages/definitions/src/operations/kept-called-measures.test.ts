import { PayloadsOutside } from '@on.auto/operations/payloads';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type RunContext } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { watchedStore } from '../testing/kept-payloads.ts';
import { longerThanAFactHolds } from '../testing/saved-definitions.ts';

const longestPostMs = 70_000;

const posting = defineCapability({
  type: 'posting',
  title: 'Posting',
  guide: { name: 'posting' },
  noun: { one: 'post', other: 'posts' },
  describeOutput: () => 'It posted.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  run: () => Effect.succeed({ output: null, record: {} }),
  longestRunOf: () => longestPostMs,
});

function measuringInto(remembered: (run: RunContext) => void) {
  return defineCapability({
    type: 'measuring',
    title: 'Measuring',
    guide: { name: 'measuring' },
    noun: { one: 'measure', other: 'measures' },
    describeOutput: () => 'It measured.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    run: (_source, _input, run) =>
      Effect.gen(function* () {
        remembered(run);
        const longest = [yield* run.longestRunOf('posting', 'post'), yield* run.longestRunFor('posting', 'post', {})];
        return { output: { longest: longest.map((ms) => ms ?? null) }, record: {} };
      }),
  });
}

const toAlpha = toPlaybook('acme', 'alpha');

const longPost = longerThanAFactHolds('Post to the channel the playbook names.');

async function measuredWhere({ readable }: { readonly readable: boolean }) {
  const watched = watchedStore();
  const definitions = harness(undefined, watched.store);
  const contexts: RunContext[] = [];
  const operations = definitionOperationsFor([
    measuringInto((run) => {
      contexts.push(run);
    }),
    posting,
  ]);
  const saved = (type: string, name: string, source: string) =>
    definitions.run(
      definitions
        .dispatch(operations.createDefinition, toAlpha(acmeAdmin, { type, name, source }))
        .pipe(Effect.provideService(PayloadsOutside, true)),
    );
  await saved('posting', 'post', longPost);
  await saved('measuring', 'calls', 'Measures the post it calls');
  if (!readable) {
    watched.fail();
  }
  const answered = await definitions.call(
    operations.runDefinition,
    toAlpha(acmeAdmin, { type: 'measuring', name: 'calls' }),
  );
  return { answered, reads: watched.reads(), contexts };
}

describe('a run that measures a definition it calls, whose document its playbook keeps outside its facts', () => {
  it('reads that document for each measure and is given the bound its capability declares', async () => {
    expect(await measuredWhere({ readable: true })).toMatchObject({
      answered: { status: 'succeeded', output: { output: { longest: [longestPostMs, longestPostMs] } } },
      reads: 2,
    });
  });

  it('is measured wherever the measure is asked, needing nothing from the run that asks', async () => {
    const { contexts } = await measuredWhere({ readable: true });

    expect(await Effect.runPromise(Effect.forEach(contexts, (run) => run.longestRunOf('posting', 'post')))).toEqual([
      longestPostMs,
    ]);
  });

  it('is given no measure while that document cannot be read, and runs all the same', async () => {
    expect(await measuredWhere({ readable: false })).toMatchObject({
      answered: { status: 'succeeded', output: { output: { longest: [null, null] } } },
    });
  });
});
