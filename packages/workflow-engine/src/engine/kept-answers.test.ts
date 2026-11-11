import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { errorType } from '../dsl/raised-error.ts';
import { answeredByItsDigest, answeredOutput, keptOutput, waitingForItsAnswer } from '../kept-testing/kept-answers.ts';
import { keptValuesIn } from '../kept-testing/kept-events.ts';
import { ContentUnavailable } from '../run-log/content-unavailable.ts';
import { stateFormat, stateFormatKeepingPayloads } from '../run-log/state-format.ts';
import { drivenRunId } from '../testing/run-history.ts';

describe('a call answered with its output kept outside, by its digest and size', () => {
  it('is decided from the output read back from the store, and held kept again under the same digest, which is not put again', () => {
    const driver = waitingForItsAnswer(true);
    const keptBefore = driver.ports.payloads.keeps().length;

    const submitted = driver.submit(answeredByItsDigest(driver));
    const last = driver.ports.runStore.events(drivenRunId).at(-1)?.event;
    driver.clock.advance();

    expect(submitted.outcome).toBe('applied');
    expect(driver.ports.payloads.reads()).toEqual([[keptOutput.sha256]]);
    expect(driver.ports.payloads.keeps().slice(keptBefore)).toEqual([]);
    expect(last).toMatchObject({ format: stateFormatKeepingPayloads, kept: [keptOutput] });
    expect(JSON.stringify(driver.ports.runStore.events(drivenRunId).at(-1)?.event)).toContain('{"length":40000}');
  });

  it('is held inline where the engine keeps nothing outside, so the run’s log stays at format 11 with the output in it', () => {
    const driver = waitingForItsAnswer(false);

    driver.submit(answeredByItsDigest(driver));
    const last = driver.ports.runStore.events(drivenRunId).at(-1)?.event;

    expect(last?.format).toBe(stateFormat);
    expect(keptValuesIn(driver.state(drivenRunId))).toEqual([]);
    expect(JSON.stringify(last)).toContain(answeredOutput);
  });

  it('is read nowhere once its call is no longer open, so a stale answer costs no read', () => {
    const driver = waitingForItsAnswer(true);
    const answer = answeredByItsDigest(driver);
    driver.submit(answer);
    const readsBefore = driver.ports.payloads.reads().length;

    const again = driver.submit(answer);

    expect(again.outcome).toBe('stale');
    expect(driver.ports.payloads.reads()).toHaveLength(readsBefore);
  });
});

describe('a call answered with an output kept outside that cannot be read', () => {
  it.each([
    ['missing', 'is missing from the content it was kept in'],
    ['erased', 'was erased'],
  ] as const)('ends the run when the output is %s, naming its digest, and settles it rejected', (kind, said) => {
    const driver = waitingForItsAnswer(true);
    driver.ports.payloads.lose(keptOutput.sha256, kind);

    const submitted = driver.submit(answeredByItsDigest(driver));

    expect(submitted.outcome).toBe('applied');
    expect(driver.state(drivenRunId).outcome).toEqual({
      kind: 'raised',
      error: {
        type: errorType('runtime'),
        status: 500,
        title: `The output a call answered, kept under ${keptOutput.sha256}, ${said}`,
        instance: '/',
      },
    });
    expect(driver.ports.recordStore.settlementOf(drivenRunId)).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
    });
  });

  it('fails as unavailable while the store cannot answer, appending nothing, and is decided when given again', () => {
    const driver = waitingForItsAnswer(true);
    const answer = answeredByItsDigest(driver);
    const before = driver.ports.runStore.events(drivenRunId).length;
    driver.ports.payloads.failNext('read');

    const failed = Effect.runSyncExit(driver.engine.submit(answer));
    const appendedMeanwhile = driver.ports.runStore.events(drivenRunId).length - before;
    const again = driver.submit(answer);

    expect(failed).toEqual(
      Exit.fail(new ContentUnavailable({ detail: 'The store of payloads was told to fail its next read' })),
    );
    expect([appendedMeanwhile, again.outcome]).toEqual([0, 'applied']);
  });
});
