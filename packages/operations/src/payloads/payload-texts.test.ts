import { sha256Of } from '@on.auto/content';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { PayloadsOutside, jsonPayloadText, payloadChosen, textBytesOf, textPayloadText } from './payload-texts.ts';

const atTheLimit = 'x'.repeat(2048);

const pastTheLimit = 'x'.repeat(2049);

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

  it('is inline up to 2,048 bytes of text, and kept outside past them, with the digest and size of its text to keep', () => {
    const value = { note: 'é'.repeat(1024) };
    const text = jsonPayloadText(value);

    expect([payloadChosen(atTheLimit, textPayloadText(atTheLimit), true), payloadChosen(value, text, true)]).toEqual([
      { payload: { inline: atTheLimit } },
      {
        payload: { kept: { sha256: sha256Of(text.text), bytes: 2059 } },
        toKeep: { sha256: sha256Of(text.text), bytes: 2059, ...text },
      },
    ]);
  });

  it('is inline for a text with a lone surrogate, which UTF-8 cannot carry and so could not be read back as written', () => {
    const lone = `${pastTheLimit}\uD800`;

    expect(payloadChosen(lone, textPayloadText(lone), true)).toEqual({ payload: { inline: lone } });
  });

  it('is decided by a switch that is off unless the shell turns it on', () => {
    const switchedOn = Effect.gen(function* () {
      return yield* PayloadsOutside;
    });

    expect(Effect.runSync(switchedOn)).toBe(false);
    expect(Effect.runSync(Effect.provideService(switchedOn, PayloadsOutside, true))).toBe(true);
  });
});
