import type { Outcome } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { memoryHarness, type MemoryHarness } from '../testing/index.ts';

interface Interleaved {
  readonly harness: MemoryHarness;
  readonly answers: readonly Outcome[];
}

interface Armed extends Interleaved {
  readonly arm: () => void;
}

function idIn(stream: string): string {
  return stream.slice(stream.lastIndexOf('/') + 1);
}

async function textsIn(harness: MemoryHarness, stream: string): Promise<readonly (string | null)[]> {
  const facts = await harness.factsOf(stream);
  return facts.flatMap((fact) => (fact.type === 'memory_remembered' ? [fact.data.text] : []));
}

function replacing(harness: () => MemoryHarness, stream: string, heard: (answer: Outcome) => void) {
  return Effect.map(
    Effect.promise(() =>
      harness().call(harness().operations.remember, { text: 'A corrected secret', replaces: idIn(stream) }),
    ),
    heard,
  );
}

function replacedAsEachVersionIsErased(): Interleaved {
  const answers: Outcome[] = [];
  const harness: MemoryHarness = memoryHarness({
    over: (ledger) => ({
      ...ledger,
      scrubFact: (stream, position, scrub) =>
        Effect.andThen(
          replacing(
            () => harness,
            stream,
            (answer) => {
              answers.push(answer);
            },
          ),
          ledger.scrubFact(stream, position, scrub),
        ),
    }),
  });
  return { harness, answers };
}

function replacedOnceTheMemoryIsFound(): Armed {
  const answers: Outcome[] = [];
  const heard = (answer: Outcome) => {
    answers.push(answer);
  };
  let armed = false;
  const harness: MemoryHarness = memoryHarness({
    over: (ledger) => ({
      ...ledger,
      load: (stream, fold) => {
        const between = armed ? replacing(() => harness, stream, heard) : Effect.void;
        armed = false;
        return Effect.tap(ledger.load(stream, fold), () => between);
      },
    }),
  });
  return {
    harness,
    answers,
    arm: () => {
      armed = true;
    },
  };
}

describe('erasing a memory while a new version of it is asked', () => {
  it('refuses the new version asked while the text is erased, since the memory is forgotten first', async () => {
    const { harness, answers } = replacedAsEachVersionIsErased();
    const id = await harness.rememberedId({ text: 'A secret' });

    const erased = await harness.call(harness.operations.forget, { id, erase: true });

    expect(erased).toMatchObject({ status: 'succeeded', output: { id, status: 'erased' } });
    expect(answers).toMatchObject([
      {
        status: 'rejected',
        reason: 'conflict',
        detail: `The memory ${id} was forgotten, so no new version can replace it`,
      },
    ]);
    expect(await textsIn(harness, `playbook/acme/alpha/memories/${id}`)).toEqual([null]);
  });
});

describe('erasing a memory that gained a version after it was found', () => {
  it('erases the version kept after the memory was found and before it was forgotten', async () => {
    const { harness, answers, arm } = replacedOnceTheMemoryIsFound();
    const id = await harness.rememberedId({ text: 'A secret' });
    arm();

    const erased = await harness.call(harness.operations.forget, { id, erase: true });

    expect(erased).toMatchObject({ status: 'succeeded', output: { id, status: 'erased' } });
    expect(answers).toMatchObject([{ status: 'succeeded', output: { id, version: 2 } }]);
    expect(await textsIn(harness, `playbook/acme/alpha/memories/${id}`)).toEqual([null, null]);
    expect((await harness.factsOf(`playbook/acme/alpha/memories/${id}`)).map(({ type }) => type)).toEqual([
      'memory_remembered',
      'memory_remembered',
      'memory_forgotten',
      'memory_erased',
      'memory_erased',
    ]);
  });
});
