import { foldOf, recallDocument } from '@on.auto/recall/testing';
import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha } from '../testing/servers/reasoning-server.ts';
import {
  playbookWithReviews,
  inState,
  recalled,
  servingRecall,
  standingUntil,
  verdicts,
} from '../testing/servers/recall-server.ts';
import { patientWorkerPool } from '../testing/servers/worker-pools.ts';

const reviewRuns =
  'language: typescript\nsource:\n  events:\n    - type: run_succeeded\n      subject: reasoning/review-brief';

const strings =
  '---\nlanguage: typescript\noutput:\n  schema: {type: array, items: {type: string}}\n---\nexport default function (input: any): any {\n  return [1, 2, 3, 4];\n}';

const answeredWrong = recallDocument(
  foldOf('return view;', 'return [1];'),
  `${reviewRuns}\nview:\n  initial: {}\noutput:\n  schema: {type: string}`,
);

const outgrowing = recallDocument(
  foldOf('return [...view, 1];'),
  `${reviewRuns}\nview:\n  initial: []\n  schema: {type: array, maxItems: 0}`,
);

const decodeStall = Schema.decodeUnknownSync(
  Schema.Struct({ standing: Schema.Struct({ stalled: Schema.Struct({ kind: Schema.String, error: Schema.String }) }) }),
);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function recordingModules(pool: ProgramPool, modules: Set<string | undefined>): ProgramPool {
  return {
    ...pool,
    run: (request, signal) => {
      modules.add(request.worker?.pathname.split('/').at(-1));
      return pool.run(request, signal);
    },
    fold: (request, signal) => {
      modules.add(request.worker?.pathname.split('/').at(-1));
      return pool.fold(request, signal);
    },
  };
}

describe('values their schemas refuse, through the one checked worker, over HTTP', () => {
  it('refuse a computation output and a recall answer, and stall a view, in the one wording of the issues', async () => {
    const modules = new Set<string | undefined>();
    const server = await servingRecall(verdicts({ campaign: 'spring', verdict: 'approve' }), {}, (settings, handed) =>
      recordingModules(patientWorkerPool(settings, handed), modules),
    );
    closing.push(server.stop);
    await playbookWithReviews(server, 1);
    await server.call('POST', `${alpha}/definitions/computation`, { body: { name: 'strings', source: strings } });
    await server.call('POST', `${alpha}/definitions/recall`, { body: { name: 'wrong', source: answeredWrong } });
    await server.call('POST', `${alpha}/definitions/recall`, { body: { name: 'outgrowing', source: outgrowing } });

    const computed = await server.call('POST', `${alpha}/definitions/computation/strings/run`, {
      body: { input: {} },
    });
    await standingUntil(server, 'wrong', inState('live'));
    const answered = await recalled(server, 'wrong', {});
    const stalled = decodeStall(await standingUntil(server, 'outgrowing', inState('stalled'))).standing.stalled;

    expect(computed).toMatchObject({
      status: 409,
      body: {
        kind: 'unworkable',
        detail:
          "The program's output does not match the output schema: /0: Expected string; /1: Expected string; /2: Expected string",
      },
    });
    expect(answered).toMatchObject({
      status: 409,
      body: {
        kind: 'unworkable',
        detail: 'The answer does not match the output schema: the output: Expected string',
      },
    });
    expect(stalled).toEqual({ kind: 'schema', error: 'the view: Expected a value with a length of at most 0' });
    expect([...modules].filter((module) => module !== undefined)).toEqual(['checked-worker.ts']);
  });
});
