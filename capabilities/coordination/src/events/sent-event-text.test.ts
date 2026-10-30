import { echo } from '@on.auto/definitions/testing';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { playbookOn } from '../testing/playbook.ts';
import { testPlaybookNames } from '../testing/test-sandbox.ts';
import { defineSendRunEvent } from './send-run-event.ts';

const playbook = playbookOn(memoryLedger(), [echo]);

const sendEvent = defineSendRunEvent({ deliver: () => Effect.die('An event was delivered') }, testPlaybookNames);

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const unspeakable = ['\u0000', '\u001F', '\u007F', '\u009F', '\uD800', '\uDC00', '\uFFFE', '\uFDD0'];

const IssuesSchema = Schema.Struct({ issues: Schema.Array(Schema.Struct({ pointer: Schema.String })) });

function pointersOf(outcome: unknown): readonly string[] {
  return Schema.decodeUnknownSync(IssuesSchema)(outcome).issues.map(({ pointer }) => pointer);
}

function sending(event: object) {
  return playbook.call(sendEvent, { run_id: runId, event });
}

describe('the text of an event sent to a run', () => {
  it('holds no control character, unpaired surrogate or noncharacter, as an event published to the playbook', async () => {
    const sent = await Promise.all(
      unspeakable.map((character) =>
        sending({ type: `t${character}`, id: `i${character}`, source: `s${character}`, subject: `s${character}` }),
      ),
    );

    expect(sent.map((outcome) => pointersOf(outcome))).toEqual(
      unspeakable.map(() => ['/event/type', '/event/source', '/event/subject', '/event/id']),
    );
  });

  it('names its type, id and subject with a character that is not a space', async () => {
    expect(pointersOf(await sending({ type: ' ', id: ' ', subject: '' }))).toEqual([
      '/event/type',
      '/event/subject',
      '/event/id',
    ]);
  });

  it('comes from a source that is a URI reference, as an event published to the playbook', async () => {
    const refused = await Promise.all(
      ['', 'the ledger', 'ledger%2'].map(async (source) => pointersOf(await sending({ type: 'com.acme.x', source }))),
    );

    expect(refused).toEqual([['/event/source'], ['/event/source'], ['/event/source']]);
    expect(
      await Promise.all(
        ['/ledger/eu', 'https://acme.example/ledger?region=eu', 'urn:acme:ledger'].map((source) =>
          sending({ type: 'com.acme.x', source }),
        ),
      ),
    ).toMatchObject([{ reason: 'not_found' }, { reason: 'not_found' }, { reason: 'not_found' }]);
  });

  it('takes text in any script, emoji included', async () => {
    expect(await sending({ type: 'com.acme.grüße', subject: '😀 a reply' })).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
    });
  });
});
