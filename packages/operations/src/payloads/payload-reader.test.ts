import { contentOfBytes, contentOfText, notTheBytesOfItsDigest, sha256Of } from '@on.auto/content';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { keptContentGraceMs } from '../held-content/unheld-removal.ts';
import {
  afterWaiting,
  alpha,
  answering,
  askedOf,
  contentWith,
  countedOver,
  digestedOf,
  endless,
  failingStream,
  failureAt,
  failureOf,
  hanging,
  json,
  keptFor,
  missingOf,
  notReadNow,
  oneHangingAndOneUnheld,
  readerOver,
  unreachable,
  value,
  watchedStream,
  type ReadContent,
} from '../payload-testing/payload-samples.ts';
import { payloadCacheWithin } from './payload-cache.ts';
import { payloadKept } from './payload-keeping.ts';
import { mostPayloadBytesReadAtOnce, payloadReaderOf } from './payload-reader.ts';
import { payloadWaitOf } from './payload-waits.ts';

const now = Date.parse('2026-11-10T09:00:00.000Z');

const notItsBytes = 'was read back as other bytes than its digest names';

const notHeld = "is not in the playbook's content";

const notItsKind = 'is not text of the kind its fact names';

const tooMany = `RangeError: A read asked for ${mostPayloadBytesReadAtOnce + 1} bytes of payloads at once, more than ${mostPayloadBytesReadAtOnce}`;

const headOf = (keptAt: number) => ({ bytes: json.bytes, mediaType: json.mediaType, keptAt });

function defectOf(read: Effect.Effect<unknown, unknown>): Promise<string> {
  return Effect.runPromise(
    Effect.catchDefect(Effect.as(Effect.orDie(read), 'read'), (died) => Effect.succeed(String(died))),
  );
}

const nothing: ReadContent = { get: () => Effect.never, getHead: () => Effect.never };

describe('a payload read back from the content of its playbook', () => {
  it('is the text kept under its digest, or the value of that text as JSON', async () => {
    const text = keptFor('p'.repeat(4000));
    const reader = readerOver(await contentWith(json, text));

    const read = await Effect.runPromise(Effect.all([reader.json(digestedOf(json)), reader.text(digestedOf(text))]));

    expect(read).toEqual([value, 'p'.repeat(4000)]);
  });

  it('is read on the second ask where the first finds nothing, as the store may not find at once a content just put', async () => {
    const asked = askedOf({ reads: [undefined, contentOfText(json.text, json.mediaType)] });

    const read = await Effect.runPromise(readerOver(asked.content).json(digestedOf(json)));

    expect([read, asked.gets()]).toEqual([value, 2]);
  });

  it('is read from the cache it was kept or read into, with no read of the store', async () => {
    const content = await contentWith();
    const cache = payloadCacheWithin(1_000_000);
    await Effect.runPromise(payloadKept(content, alpha, json, cache));

    const read = await Effect.runPromise(payloadReaderOf({ owner: alpha, content: unreachable, cache }).json(json));

    expect(read).toEqual(value);
  });
});

describe('a set of payloads read back at once', () => {
  it('is read each digest once, six at a time or as many as its reader is given, as texts by digest', async () => {
    const kept = Array.from({ length: 10 }, (_, index) => keptFor(String(index).repeat(2100)));
    const content = await contentWith(...kept);
    const asked = [...kept, ...kept].map((each) => digestedOf(each));
    const [six, three] = [countedOver(content), countedOver(content)];

    const texts = await Effect.runPromise(
      Effect.all([readerOver(six.content).all(asked), readerOver(three.content, 3).all(asked)]),
    );

    const byDigest = kept.map(({ sha256, text }) => [sha256, text]);
    expect(texts.map((each) => Array.from(each))).toEqual([byDigest, byDigest]);
    expect([six.mostAtOnce(), three.mostAtOnce()]).toEqual([6, 3]);
  });

  it('is refused, as a defect of its caller, past 8 MiB, as one payload past it is', async () => {
    const huge = { sha256: 'a'.repeat(64), bytes: mostPayloadBytesReadAtOnce };
    const reader = readerOver(unreachable);

    const defects = [
      await defectOf(reader.text({ ...huge, bytes: huge.bytes + 1 })),
      await defectOf(reader.all([huge, { sha256: 'b'.repeat(64), bytes: 1 }])),
    ];

    expect(defects).toEqual([tooMany, tooMany]);
  });
});

describe('a payload whose bytes are not kept', () => {
  it('is missing where the store finds nothing twice, and keeps no head of it or one last kept before the hour', async () => {
    const answers = [
      askedOf({ reads: [undefined] }),
      askedOf({ reads: [undefined], head: headOf(now - keptContentGraceMs - 1) }),
    ];

    const failures = await Promise.all(
      answers.map(({ content }) => failureAt(now, readerOver(content).text(digestedOf(json)))),
    );

    expect(failures).toEqual([
      missingOf(json.sha256, 'not_held', notHeld),
      missingOf(json.sha256, 'not_held', notHeld),
    ]);
    expect(answers.map(({ gets }) => gets())).toEqual([2, 2]);
  });

  it('is unavailable where the store finds nothing twice but its head was kept within the hour, as its bytes may be on their way', async () => {
    const asked = askedOf({ reads: [undefined], head: headOf(now - keptContentGraceMs) });

    expect(await failureAt(now, readerOver(asked.content).text(digestedOf(json)))).toEqual(notReadNow);
  });

  it('is missing where its bytes are not text, or its text is not JSON where JSON is read', async () => {
    const notJson = keptFor('not json '.repeat(300));
    const notText = new Uint8Array([0xff, 0xfe, 0xfd]);
    const bytesRead = readerOver(answering(contentOfBytes(notText, 'application/json')));

    const failures = [
      await failureOf(bytesRead.text({ sha256: sha256Of(notText), bytes: 3 })),
      await failureOf(readerOver(answering(contentOfText(notJson.text, 'text/plain'))).json(digestedOf(notJson))),
    ];

    expect(failures).toEqual([
      missingOf(sha256Of(notText), 'not_its_kind', notItsKind),
      missingOf(notJson.sha256, 'not_its_kind', notItsKind),
    ]);
  });
});

describe('a payload read back as other bytes', () => {
  it('is missing, whether the store or the reader finds them so', async () => {
    const reads = [
      answering(contentOfText(`${json.text.slice(0, -1)} `, 'application/json')),
      answering({ ...contentOfText(json.text.slice(1), 'application/json'), bytes: json.bytes }),
      answering(failingStream(notTheBytesOfItsDigest(json.sha256), json.bytes)),
    ];

    const failures = await Promise.all(reads.map((content) => failureOf(readerOver(content).text(digestedOf(json)))));

    expect(failures).toEqual(reads.map(() => missingOf(json.sha256, 'not_its_bytes', notItsBytes)));
  });

  it('is missing, with nothing read and its stream let go of, where the store answers a size other than its fact names', async () => {
    const watched = watchedStream(json.bytes + 1, endless);

    const failure = await failureOf(readerOver(answering(watched.content)).text(digestedOf(json)));

    expect([failure, watched.pulls(), watched.cancelled()]).toEqual([
      missingOf(json.sha256, 'not_its_bytes', notItsBytes),
      0,
      true,
    ]);
  });

  it('is missing once the store streams more bytes than its fact names, read no further than the piece that passes them', async () => {
    const watched = watchedStream(json.bytes, endless);

    const failure = await failureOf(readerOver(answering(watched.content)).text(digestedOf(json)));

    expect([failure, watched.pulls(), watched.cancelled()]).toEqual([
      missingOf(json.sha256, 'not_its_bytes', notItsBytes),
      Math.floor(json.bytes / 1024) + 1,
      true,
    ]);
  });
});

describe('a payload the store does not answer for', () => {
  it('is unavailable, to be asked again, where the store or its head fails to answer, or its stream fails on the way', async () => {
    const reads = [
      unreachable,
      { ...askedOf({ reads: [undefined] }).content, getHead: unreachable.getHead },
      answering(failingStream(new TypeError('terminated'), json.bytes)),
    ];

    const failures = await Promise.all(reads.map((content) => failureOf(readerOver(content).json(digestedOf(json)))));

    expect(failures).toEqual([notReadNow, notReadNow, notReadNow]);
  });

  it('is unavailable where the store has not answered within the wait for its size, and lets go of the stream it was reading', async () => {
    const watched = watchedStream(json.bytes, hanging);
    const wait = payloadWaitOf(json.bytes);

    const failures = [
      await afterWaiting(readerOver(nothing).text(digestedOf(json)), wait, Promise.resolve()),
      await afterWaiting(readerOver(answering(watched.content)).text(digestedOf(json)), wait, watched.reached),
    ];

    expect([...failures, watched.cancelled()]).toEqual([notReadNow, notReadNow, true]);
  });

  it('lets go of the streams of a set still read once one of its payloads cannot be had', async () => {
    const watched = watchedStream(json.bytes, hanging);
    const other = keptFor('o'.repeat(3000));
    const reader = readerOver(oneHangingAndOneUnheld(watched, json.sha256));

    const failure = await failureOf(reader.all([digestedOf(json), digestedOf(other)]));

    expect([failure, watched.cancelled()]).toEqual([missingOf(other.sha256, 'not_held', notHeld), true]);
  });
});
