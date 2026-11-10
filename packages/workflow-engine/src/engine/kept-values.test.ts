import { sha256Of } from '@on.auto/content';
import { describe, expect, it } from 'vitest';

import { argumentsPerformedBy, keptAlong, keptValuesIn } from '../kept-testing/kept-events.ts';
import { isKept } from '../machine/held-contents.ts';
import { mostInlineHeldValueBytes } from '../machine/limits.ts';
import { stateFormat, stateFormatKeepingPayloads } from '../run-log/state-format.ts';
import { drivenRun, outputsIn, statesAlong, type DrivenRun } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const large = 'x'.repeat(20_000);

const answer = { text: 'y'.repeat(30_000) };

const shapedLikeAReference = { sha256: 'a'.repeat(64), bytes: 12 };

const asking = workflow(`
do:
  - ask: { call: notify, with: { to: '\${ $data.to }', subject: hello } }
  - pause: { wait: PT1M }
  - measure: { set: '\${ ({ length: $data.text.length }) }' }
  - look: { wait: PT1M }
  - shape: { set: ${JSON.stringify(shapedLikeAReference)} }
  - rest: { wait: PT1M }
`);

const callArguments = { to: large, subject: 'hello' };

const textOf = (value: unknown): string => JSON.stringify(value);

function asked(keepsPayloadsOutside: boolean): DrivenRun {
  return drivenRun(asking, {
    input: { to: large },
    respond: () => ({ after: 10, result: { status: 'succeeded', output: answer } }),
    keepsPayloadsOutside,
  });
}

const ended = { kind: 'completed', output: shapedLikeAReference };

describe('a run whose engine keeps nothing outside', () => {
  it('writes every event in format 11, with no kept member and every value inline, as before', () => {
    const run = asked(false);

    expect(run.outcome).toEqual(ended);
    expect(run.events.map(({ event }) => event.format)).toEqual(run.events.map(() => stateFormat));
    expect(keptAlong(run.events).every((kept) => kept === undefined)).toBe(true);
    expect(run.driver.ports.payloads.keeps()).toEqual([]);
    expect(statesAlong(run.events).flatMap((state) => keptValuesIn(state))).toEqual([]);
  });
});

const run = asked(true);

describe('a run whose engine keeps its large values outside', () => {
  it('ends as the same run with every event in format 12', () => {
    expect(run.outcome).toEqual(ended);
    expect(run.events.map(({ event }) => event.format)).toEqual(run.events.map(() => stateFormatKeepingPayloads));
  });

  it('reads nothing back from the store while the run stays loaded, the engine holding the texts it kept', () => {
    expect(run.driver.ports.payloads.reads()).toEqual([]);
  });

  it('keeps each value past the engine’s own threshold once, by its digest, and names it in the event that first holds it', () => {
    const digests = [textOf({ to: large }), textOf(callArguments)].map((text) => sha256Of(text));

    expect(keptAlong(run.events)[0]).toEqual(digests);
    expect(run.driver.ports.payloads.keeps().flat()).toEqual([...digests, sha256Of(textOf(answer))]);
    expect([...run.driver.ports.payloads.texts().values()]).toEqual([
      textOf({ to: large }),
      textOf(callArguments),
      textOf(answer),
    ]);
  });
});

describe('the call a run that keeps its values outside starts', () => {
  it('names its arguments once in the record that starts the call: the held value and the start name one digest', () => {
    const start = outputsIn(run.events).find(({ kind }) => kind === 'start_call');
    const recorded = JSON.stringify(run.events[0]?.event);

    expect(start).toMatchObject({
      arguments_sha256: sha256Of(textOf(callArguments)),
      arguments_bytes: textOf(callArguments).length,
    });
    expect(start).not.toHaveProperty('arguments');
    expect([recorded.includes(large), recorded.length < 8192]).toEqual([false, true]);
  });

  it('hands the executor the whole arguments, read back from what it kept', () => {
    expect(argumentsPerformedBy(run.driver)).toEqual([callArguments]);
  });

  it('keeps a value at or under the threshold inline, a value shaped like a reference among them', () => {
    const held = statesAlong(run.events).flatMap((state) => Object.values(state.machine.values));
    const inline = held.filter((value) => !isKept(value));

    expect(inline.every(({ bytes }) => bytes <= mostInlineHeldValueBytes)).toBe(true);
    expect(held.filter((value) => isKept(value)).every(({ bytes }) => bytes > mostInlineHeldValueBytes)).toBe(true);
    expect(inline).toContainEqual({ value: shapedLikeAReference, bytes: textOf(shapedLikeAReference).length });
    expect(JSON.stringify(run.events)).toContain('{"length":30000}');
  });
});
