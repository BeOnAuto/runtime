import { Readable } from 'node:stream';

import { textToKeep } from '@on.auto/operations';
import { alpha, deliveredBeforeFailing, octets, present, resultOf } from '@on.auto/operations/testing';
import { sdkStreamMixin } from '@smithy/core/serde';
import { Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { storageWaits } from '../client/storage-client.ts';
import { objectKeysOf } from '../location/object-keys.ts';
import { fakeBucket } from '../testing/fake-bucket.ts';
import { objectContentOn } from './object-content.ts';

const location = { bucket: 'content', prefix: 'playbooks' };

describe('a read on object storage whose store stops sending', () => {
  it('fails once the store has sent no piece for the wait of a request, and lets go of the body', async () => {
    const bucket = fakeBucket();
    const client = bucket.client();
    const store = objectContentOn(() => client, location, { ...storageWaits, requestMs: 100 });
    const kept = await resultOf(store.content.put(alpha, textToKeep('stalled', octets)));
    const silent = new Readable({ read: Function.constVoid });
    bucket.intercepting('GetObjectCommand', async (asked) => ({ ...(await asked()), Body: sdkStreamMixin(silent) }));

    const read = await present(store.content.get(alpha, kept.sha256));
    const delivered = await deliveredBeforeFailing(read.stream);

    expect(delivered).toEqual({
      bytes: 0,
      failure: new Error(
        `The object store sent no piece of ${objectKeysOf(location).kept(alpha, kept.sha256)} for 100 ms`,
      ),
    });
    expect(silent.destroyed).toBe(true);
  });

  it('lets go of the body of an object its reader leaves', async () => {
    const bucket = fakeBucket();
    const client = bucket.client();
    const store = objectContentOn(() => client, location);
    const kept = await resultOf(store.content.put(alpha, textToKeep('left', octets)));
    const silent = new Readable({ read: Function.constVoid });
    bucket.intercepting('GetObjectCommand', async (asked) => ({ ...(await asked()), Body: sdkStreamMixin(silent) }));

    const read = await present(store.content.get(alpha, kept.sha256));
    await read.stream.cancel('The reader left');

    expect(silent.destroyed).toBe(true);
  });
});
