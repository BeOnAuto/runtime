import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineQuery, Unavailable, type DispatcherServices, type Outcome } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toOrg, toPlaybook } from '../testing/harness.ts';
import { explode } from '../testing/misbehaving.ts';
import { addNote, getNote } from '../testing/notes.ts';
import { labelPlaybook } from '../testing/playbook-labels.ts';
import { recordingTracer, type RecordedSpan } from '../testing/recording-tracer.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const Empty = Schema.Record(Schema.String, Schema.Never);

const askModel = defineQuery('playbook', {
  name: 'ask_model',
  title: 'Ask a model',
  description: 'Is refused because no provider of the model is configured.',
  route: { method: 'GET', path: '/ask-model' },
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: ['unavailable'],
  handle: () =>
    Effect.fail(
      new Unavailable({
        detail: 'No provider of the model is configured',
        kind: 'model_not_offered',
        because: 'provider_not_configured',
      }),
    ),
});

const { dispatcher } = harness();

async function spansOf(call: Effect.Effect<Outcome, never, DispatcherServices>): Promise<readonly RecordedSpan[]> {
  const { run } = harness();
  const { tracer, spans } = recordingTracer();
  await run(call.pipe(Effect.withTracer(tracer)));
  return spans();
}

describe('the span of a dispatched operation', () => {
  it('is named for the operation and carries its kind, org, playbook, caller and outcome', async () => {
    expect(
      await spansOf(
        dispatcher.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })),
      ),
    ).toMatchObject([
      {
        name: 'add_note',
        attributes: {
          'auto.on.operation': 'add_note',
          'auto.on.operation.kind': 'command',
          'auto.on.org': 'acme',
          'auto.on.playbook': 'alpha',
          'auto.on.caller': 'acme-admin',
          'auto.on.outcome': 'succeeded',
        },
        ending: 'succeeded',
      },
    ]);
  });

  it('carries the depth, call depth and correlation of a call made for a run', async () => {
    const [span] = await spansOf(
      dispatcher.dispatchToPlaybook(getNote.registration, {
        ...toAlpha(acmeAdmin, { name: 'anvil' }),
        depth: 2,
        callDepth: 1,
        lineage: { causationId: 'cause-1', correlationId: 'run-0' },
      }),
    );

    expect(span?.attributes).toMatchObject({
      'auto.on.depth': 2,
      'auto.on.call_depth': 1,
      'auto.on.correlation_id': 'run-0',
    });
  });
});

describe('the span of a dispatched operation without a run', () => {
  it('leaves the correlation out when the call has none', async () => {
    const [span] = await spansOf(
      dispatcher.dispatchToPlaybook(getNote.registration, {
        ...toAlpha(acmeAdmin, { name: 'anvil' }),
        lineage: { causationId: null, correlationId: null },
      }),
    );

    expect(span?.attributes).not.toHaveProperty('auto.on.correlation_id');
  });

  it('is named for an operation of the org, with no playbook', async () => {
    const [span] = await spansOf(
      dispatcher.dispatchToOrg(labelPlaybook.registration, toOrg('acme')(acmeAdmin, { playbook: 'alpha', label: 'x' })),
    );

    expect(span).toMatchObject({ name: 'label_playbook', ending: 'succeeded' });
    expect(span?.attributes).not.toHaveProperty('auto.on.playbook');
  });
});

describe('the span of a dispatched operation that is rejected', () => {
  it('ends without an error, naming the reason of the rejection as the error type', async () => {
    expect(
      await spansOf(dispatcher.dispatchToPlaybook(getNote.registration, toAlpha(acmeAdmin, { name: 'ghost' }))),
    ).toMatchObject([
      { attributes: { 'auto.on.outcome': 'rejected', 'error.type': 'not_found' }, ending: 'succeeded' },
    ]);
  });

  it('names the kind of the rejection and what it was because of', async () => {
    const [span] = await spansOf(dispatcher.dispatchToPlaybook(askModel.registration, toAlpha(acmeAdmin, {})));

    expect(span?.attributes).toMatchObject({
      'error.type': 'unavailable',
      'auto.on.rejection.kind': 'model_not_offered',
      'auto.on.rejection.because': 'provider_not_configured',
    });
  });
});

describe('the span of a dispatched operation that fails', () => {
  it('ends in error, and the dispatcher still turns the failure into an incident', async () => {
    const { run, reported } = harness();
    const { tracer, spans } = recordingTracer();
    const outcome = await run(
      dispatcher.dispatchToPlaybook(explode.registration, toAlpha(acmeAdmin, {})).pipe(Effect.withTracer(tracer)),
    );

    expect(outcome).toMatchObject({ status: 'failed' });
    expect(reported()).toHaveLength(1);
    expect(spans()).toMatchObject([{ name: 'explode', ending: 'failed' }]);
  });
});
