import { Conflict, Unavailable } from '@on.auto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { DefinitionInvalid, type ModelFailure } from '../index.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { jsonResult } from '../testing/model-results.ts';
import { reasoningWith } from '../testing/reasoning-runs.ts';

const jsonDefinition = documentOf(
  'model: openai/gpt-5\nconfig: {max_output_tokens: 200}\noutput:\n  format: json\n  schema: {type: object}',
);

const spentOnTheCall = {
  record: {
    usage: {
      input: { total: null, uncached: null, cache_read: null, cache_write: null },
      output: { total: null, text: null, reasoning: null },
      total: null,
    },
    duration_ms: 0,
  },
};

const refusedRequest = { status: 400 as const, duration_ms: 700 };

function refused(detail: string, more: Partial<ConstructorParameters<typeof DefinitionInvalid>[0]>): DefinitionInvalid {
  return new DefinitionInvalid({
    detail,
    provider: 'openai',
    status: 400,
    provider_message: null,
    issues: [],
    ...more,
  });
}

function runFailingWith(failure: () => ModelFailure) {
  const run = reasoningWith(() => Effect.fail(failure()));
  return { run, ended: run.running(jsonDefinition, { text: 'x' }) };
}

const refusedWords = 'openai refused the request (HTTP 400): the request was rejected as invalid';

describe('a JSON answer whose schema the provider refused, and then the request that described it', () => {
  it('is a conflict saying the schema was not the cause and what to check, with the words of the provider', async () => {
    const { run, ended } = runFailingWith(() =>
      refused(refusedWords, {
        provider_message: 'Unsupported parameter: temperature',
        schema_refusal: { ...refusedRequest, outcome: 'refused_again' },
      }),
    );

    expect(await ended).toEqual(
      Exit.fail(
        new Conflict({
          detail: `${refusedWords}. The answer schema was not the cause; check the model's settings in the definition, such as temperature or reasoning, or choose another model. The provider said: Unsupported parameter: temperature`,
          kind: 'unworkable',
          ...spentOnTheCall,
        }),
      ),
    );
    expect(run.journal.recorded().find(({ type }) => type === 'model_call_failed')?.data).toMatchObject({
      because: 'definition_invalid',
      schema_refusal: { outcome: 'refused_again', status: 400, duration_ms: 700 },
    });
  });

  it('is a conflict that asks for the definition to be updated when the described request was refused otherwise', async () => {
    const { ended } = runFailingWith(() =>
      refused('openai answered HTTP 404: the model was not found', {
        status: 404,
        schema_refusal: { ...refusedRequest, outcome: 'described' },
      }),
    );

    expect(await ended).toMatchObject(
      Exit.fail({
        _tag: 'conflict',
        detail: 'openai answered HTTP 404: the model was not found; update the reasoning function definition',
      }),
    );
  });
});

describe('a JSON answer whose schema the provider refused, with too little time left to describe it', () => {
  it('is unavailable, saying it was not asked for again and to try again, and records why', async () => {
    const { run, ended } = runFailingWith(() =>
      refused(refusedWords, { schema_refusal: { ...refusedRequest, outcome: 'skipped', because: 'time' } }),
    );

    expect(await ended).toEqual(
      Exit.fail(
        new Unavailable({
          detail: `${refusedWords}; too little time was left to ask again with the answer schema in the instructions; try again`,
          ...spentOnTheCall,
        }),
      ),
    );
    expect(run.journal.recorded().find(({ type }) => type === 'model_call_failed')?.data).toMatchObject({
      schema_refusal: { outcome: 'skipped', because: 'time', status: 400, duration_ms: 700 },
    });
  });
});

describe('a JSON answer asked for with its schema in the instructions after the provider refused it', () => {
  it('records the refusal on the call that answered', async () => {
    const schemaRefusal = { ...refusedRequest, outcome: 'described' as const };
    const run = reasoningWith(() =>
      Effect.succeed(jsonResult({ verdict: 'approve' }, { output_mode: 'described', schema_refusal: schemaRefusal })),
    );

    expect(await run.running(jsonDefinition, { text: 'x' })).toMatchObject(
      Exit.succeed({ output: { verdict: 'approve' } }),
    );
    expect(run.journal.recorded().find(({ type }) => type === 'model_call_answered')?.data).toMatchObject({
      output_mode: 'described',
      schema_refusal: schemaRefusal,
    });
  });
});
