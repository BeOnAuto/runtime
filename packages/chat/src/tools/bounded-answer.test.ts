import { describe, expect, it } from 'vitest';

import {
  answerReadWithin,
  isErrorOfACutAnswer,
  MOST_RESULT_BYTES,
  RESULT_BOUNDS,
  RESULT_CUT,
  RESULT_TOO_LONG,
  resultCut,
  textOfACutAnswer,
  textWithinTheBound,
} from './bounded-answer.ts';

const chunked = (...parts: readonly string[]) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start: (controller) => {
        for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
        controller.close();
      },
    }),
  );

const answer = (text: string) =>
  `event: message\ndata: {"jsonrpc":"2.0","id":"1","result":{"content":[{"type":"text","text":"${text}`;

describe('an answer read within its bound', () => {
  it('is read whole where it fits, in however many chunks', async () => {
    expect(await answerReadWithin(chunked('ab', 'cd'), 4)).toEqual({ text: 'abcd', cut: false });
    expect(await answerReadWithin(new Response(null))).toEqual({ text: '', cut: false });
  });

  it('is cut at the bound where it runs past, and the stream behind it is let go', async () => {
    const cancelled = { done: false };
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        controller.enqueue(new TextEncoder().encode('abcdef'));
      },
      cancel: () => {
        cancelled.done = true;
      },
    });
    expect(await answerReadWithin(new Response(body), 8)).toEqual({ text: 'abcdefab', cut: true });
    expect(cancelled.done).toBe(true);
  });

  it('is cut where a chunk ends exactly at the bound and more follows', async () => {
    expect(await answerReadWithin(chunked('abcd', 'e'), 4)).toEqual({ text: 'abcd', cut: true });
  });
});

describe('the text of a result', () => {
  it('stands where it fits the bound', () => {
    expect(textWithinTheBound('short')).toBe('short');
    expect(textWithinTheBound('a'.repeat(MOST_RESULT_BYTES))).toHaveLength(MOST_RESULT_BYTES);
  });

  it('is cut at the bound with the words that say how to ask for less, without a split character', () => {
    const cut = textWithinTheBound('é'.repeat(MOST_RESULT_BYTES));
    expect(cut.endsWith(`\n\n${RESULT_CUT}`)).toBe(true);
    expect(cut).not.toContain('�');
    expect(new TextEncoder().encode(cut.slice(0, cut.length - RESULT_CUT.length - 2)).byteLength).toBeLessThanOrEqual(
      MOST_RESULT_BYTES,
    );
  });
});

describe('the text of an answer that was cut', () => {
  it('is the start of the first text, decoded, with the words that say it was cut', () => {
    expect(textOfACutAnswer(answer('line\\nnext \\"quoted\\" \\u00e9 and then a half escape \\u00'))).toBe(
      `line\nnext "quoted" é and then a half escape \n\n${RESULT_CUT}`,
    );
  });

  it('is cut at the bound where its start is longer', () => {
    const text = textOfACutAnswer(answer('a'.repeat(MOST_RESULT_BYTES + 10)));
    expect(text).toBe(`${'a'.repeat(MOST_RESULT_BYTES)}\n\n${RESULT_CUT}`);
  });

  it('says it was too long where it holds no text to start from', () => {
    expect(textOfACutAnswer('event: message\ndata: {"jsonrpc":"2.0"')).toBe(RESULT_TOO_LONG);
    expect(textOfACutAnswer(answer('bad\u0001control'))).toBe(RESULT_TOO_LONG);
  });
});

describe('the error mark of a cut answer', () => {
  it('is read from a result marked as an error, or from a JSON-RPC error, and from nothing else', () => {
    expect(isErrorOfACutAnswer('{"result":{"isError":true,"content":[{"type":"text","text":"abc')).toBe(true);
    expect(isErrorOfACutAnswer('{"error":{"code":-1,"message":"abc')).toBe(true);
    expect(isErrorOfACutAnswer('{"result":{"isError":false,"content":[{"type":"text","text":"abc')).toBe(false);
    expect(isErrorOfACutAnswer('{"result":{"content":[{"type":"text","text":"say \\"isError\\":true here')).toBe(false);
  });

  it('is cut to the message of a JSON-RPC error where the answer holds no text part', () => {
    expect(textOfACutAnswer(`{"error":{"code":-1,"message":"${'m'.repeat(MOST_RESULT_BYTES + 10)}`)).toBe(
      `${'m'.repeat(MOST_RESULT_BYTES)}\n\n${RESULT_CUT}`,
    );
  });
});

describe('the bounds of a result as parameters', () => {
  it('ship with the figures of the cloud today', () => {
    expect(RESULT_BOUNDS).toEqual({ resultBytes: 65_536, answerBytesRead: 262_144 });
    expect(RESULT_CUT).toBe(resultCut(65_536));
  });

  it('cut a result and the start of a cut answer at the bytes they are given, with the words for that bound', () => {
    expect(textWithinTheBound('abcdef', 3)).toBe(`abc\n\n${resultCut(3)}`);
    expect(textWithinTheBound('abc', 3)).toBe('abc');
    expect(textOfACutAnswer('{"result":{"content":[{"type":"text","text":"abcdef', 3)).toBe(`abc\n\n${resultCut(3)}`);
  });
});
