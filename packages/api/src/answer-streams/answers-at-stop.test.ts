import { describe, expect, it } from 'vitest';

import { AnswersAtStop, requestIdsIn, stoppedWords } from './answers-at-stop.ts';

interface Streaming {
  readonly answer: Response;
  readonly said: (text: string) => void;
  readonly ended: () => void;
}

function streaming(contentType = 'text/event-stream'): Streaming {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  return {
    answer: new Response(readable, { status: 200, headers: { 'content-type': contentType } }),
    said: (text) => {
      void writer.write(encoder.encode(text));
    },
    ended: () => {
      void writer.close();
    },
  };
}

function event(message: unknown): string {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

function stoppedAnswerTo(id: number | string): string {
  return event({ jsonrpc: '2.0', id, error: { code: -32_603, message: stoppedWords } });
}

const resultTo = (id: number | string) => event({ jsonrpc: '2.0', id, result: {} });

function aTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe('the answers an MCP endpoint still owes when it stops', () => {
  it('are an error for each request still unanswered, after what its stream carried, and its stream then ends', async () => {
    const answers = new AnswersAtStop();
    const { answer, said } = streaming();
    const answering = answers.answering([7], answer);
    said(': keepalive\n\n');
    const reading = answering.text();
    await aTurn();

    answers.stop();

    await expect(reading).resolves.toBe(`: keepalive\n\n${stoppedAnswerTo(7)}`);
    expect(answers.hasStopped()).toBe(true);
  });

  it('leave out a request whose answer the stream carried already, even when it came in pieces', async () => {
    const answers = new AnswersAtStop();
    const { answer, said } = streaming();
    const answering = answers.answering([1, 'two'], answer);
    const answered = resultTo('two');
    said(answered.slice(0, 20));
    said(answered.slice(20));
    said('data: not json\n\n');
    const reading = answering.text();
    await aTurn();

    answers.stop();

    await expect(reading).resolves.toBe(`${answered}data: not json\n\n${stoppedAnswerTo(1)}`);
  });
});

describe('the answers an MCP endpoint owes for a stream that comes after it stopped', () => {
  it('are an error for each of its requests, at once, and its stream then ends', async () => {
    const answers = new AnswersAtStop();
    const { answer } = streaming();

    answers.stop();
    const answering = answers.answering([8], answer);

    await expect(answering.text()).resolves.toBe(stoppedAnswerTo(8));
  });
});

describe('the answers an MCP endpoint owes no more when it stops', () => {
  it('are none for a stream that ended before the stop', async () => {
    const answers = new AnswersAtStop();
    const { answer, said, ended } = streaming();
    const answering = answers.answering([3], answer);
    said(resultTo(3));
    ended();

    const text = await answering.text();
    answers.stop();

    expect(text).toBe(resultTo(3));
  });

  it('are none for a stream its client cancelled before the stop', async () => {
    const answers = new AnswersAtStop();
    const { answer } = streaming();
    const answering = answers.answering([4], answer);

    await answering.body?.cancel();

    expect(() => {
      answers.stop();
    }).not.toThrow();
  });

  it('are none for an answer that is not a stream, an answer to no request or an answer with no body', async () => {
    const answers = new AnswersAtStop();
    const json = Response.json({ jsonrpc: '2.0', id: 5, result: {} });
    const notified = new Response(null, { status: 202 });
    const { answer: unasked } = streaming();

    expect([answers.answering([5], json), answers.answering([6], notified), answers.answering([], unasked)]).toEqual([
      json,
      notified,
      unasked,
    ]);
    answers.stop();
    await expect(json.json()).resolves.toEqual({ jsonrpc: '2.0', id: 5, result: {} });
  });
});

describe('the requests among the messages posted to an MCP endpoint', () => {
  it('are the messages with a method and an id, in their order', () => {
    expect(
      requestIdsIn([
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, result: {} },
        undefined,
        { jsonrpc: '2.0', id: 'b', method: 'tools/list' },
      ]),
    ).toEqual([1, 'b']);
  });
});
