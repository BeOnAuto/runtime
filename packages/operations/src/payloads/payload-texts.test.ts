import { sha256Of } from '@on.auto/content';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { PayloadOffloading, jsonPayloadText, payloadChosen, textBytesOf, textPayloadText } from './payload-texts.ts';

const atTheLimit = 'x'.repeat(16_384);

const pastTheLimit = 'x'.repeat(16_385);

describe('the text of a payload', () => {
  it('is the JSON of a value as written, never canonicalised, and a document as it stands, each with its media type', () => {
    expect([jsonPayloadText({ b: 1, a: [2, 'é'] }), textPayloadText('kind: workflow\n')]).toEqual([
      { text: '{"b":1,"a":[2,"é"]}', mediaType: 'application/json' },
      { text: 'kind: workflow\n', mediaType: 'text/plain; charset=utf-8' },
    ]);
  });

  it('is measured in bytes of UTF-8', () => {
    expect([textBytesOf('abc'), textBytesOf('é'), textBytesOf('😀')]).toEqual([3, 2, 4]);
  });
});

describe('the arm a payload is recorded in', () => {
  it('is inline while payloads are not kept outside, however large', () => {
    expect(payloadChosen(pastTheLimit, textPayloadText(pastTheLimit), false)).toEqual({
      payload: { inline: pastTheLimit },
    });
  });

  it('is inline up to 16,384 bytes of text, and kept outside past them, with the digest and size of its text to keep', () => {
    const value = { note: 'é'.repeat(8192) };
    const text = jsonPayloadText(value);

    expect([payloadChosen(atTheLimit, textPayloadText(atTheLimit), true), payloadChosen(value, text, true)]).toEqual([
      { payload: { inline: atTheLimit } },
      {
        payload: { kept: { sha256: sha256Of(text.text), bytes: 16_395 } },
        toKeep: { sha256: sha256Of(text.text), bytes: 16_395, ...text },
      },
    ]);
  });

  it('is inline past the 2,048 bytes a page shows whole, up to 16,384, as it is while payloads are not kept outside', () => {
    const pastWhatAPageShows = 'x'.repeat(2049);
    const tenKiB = { notes: 'n'.repeat(10_240) };
    const chosen = (keepsOutside: boolean) => [
      payloadChosen(pastWhatAPageShows, textPayloadText(pastWhatAPageShows), keepsOutside),
      payloadChosen(tenKiB, jsonPayloadText(tenKiB), keepsOutside),
    ];

    expect(chosen(true)).toEqual([{ payload: { inline: pastWhatAPageShows } }, { payload: { inline: tenKiB } }]);
    expect(chosen(true)).toEqual(chosen(false));
  });

  it('is inline for a text with a lone surrogate, which UTF-8 cannot carry and so could not be read back as written', () => {
    const lone = `${pastTheLimit}\uD800`;

    expect(payloadChosen(lone, textPayloadText(lone), true)).toEqual({ payload: { inline: lone } });
  });

  it('is decided by a switch that is off unless the shell turns it on', () => {
    const switchedOn = Effect.gen(function* () {
      return yield* PayloadOffloading;
    });

    expect(Effect.runSync(switchedOn)).toBe(false);
    expect(Effect.runSync(Effect.provideService(switchedOn, PayloadOffloading, true))).toBe(true);
  });
});
