import { describe, expect, it } from 'vitest';

import { MOST_ANSWER_BYTES_READ, MOST_RESULT_BYTES, RESULT_CUT } from './bounded-answer.ts';
import {
  ANSWERED_NOTHING,
  directoryCallsOf,
  NOT_ANSWERED,
  NOT_LISTED,
  type SendToDirectory,
} from './directory-calls.ts';

const URL_OF_THE_DIRECTORY = 'https://runtime.example/directory';

function sending(answer: (id: string, request: Readonly<Record<string, unknown>>) => Response) {
  const sent: Request[] = [];
  const send: SendToDirectory = async (request) => {
    sent.push(request.clone());
    const asked: unknown = await request.json();
    const message = typeof asked === 'object' && asked !== null ? Object.fromEntries(Object.entries(asked)) : {};
    return answer(String(message['id']), message);
  };
  return { send, sent };
}

const streamed = (message: unknown) => new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`);

const resulting = (result: unknown) => (id: string) => streamed({ jsonrpc: '2.0', id, result });

const textResult = (text: string) => resulting({ content: [{ type: 'text', text }] });

const encoded = (text: string) => new TextEncoder().encode(text);

function unendingStream(start: string) {
  const sent = { bytes: 0 };
  const body = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(encoded(start));
    },
    pull: (controller) => {
      const chunk = encoded('b'.repeat(16_384));
      sent.bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return { body, sent };
}

describe('the directory’s tools', () => {
  it('are listed by a tools/list posted to the directory, as the definitions a model takes', async () => {
    const tool = { name: 'list_playbooks', description: 'Lists them', inputSchema: { type: 'object' } };
    const { send, sent } = sending(resulting({ tools: [tool, { name: 'bare', inputSchema: { type: 'object' } }] }));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, send).tools()).toEqual([
      tool,
      { name: 'bare', description: '', inputSchema: { type: 'object' } },
    ]);
    expect(sent.map(({ method, url }) => [method, url])).toEqual([['POST', URL_OF_THE_DIRECTORY]]);
    expect(sent[0]?.headers.get('accept')).toBe('application/json, text/event-stream');
    expect(await sent[0]?.json()).toMatchObject({ jsonrpc: '2.0', method: 'tools/list' });
  });

  it('are an error where the directory answers a status or a listing that is no listing', async () => {
    const refused = sending(() => new Response('{}', { status: 401 }));
    await expect(directoryCallsOf(URL_OF_THE_DIRECTORY, refused.send).tools()).rejects.toThrow(NOT_LISTED);
    const unlisted = sending(resulting({ tools: 'none' }));
    await expect(directoryCallsOf(URL_OF_THE_DIRECTORY, unlisted.send).tools()).rejects.toThrow(NOT_LISTED);
    const answeredToAnother = sending((_, message) => streamed({ jsonrpc: '2.0', id: 'other', result: message }));
    await expect(directoryCallsOf(URL_OF_THE_DIRECTORY, answeredToAnother.send).tools()).rejects.toThrow(NOT_LISTED);
  });
});

describe('a tool called at the directory', () => {
  it('is posted as a tools/call with its name and arguments, and answers the text of its content', async () => {
    const { send, sent } = sending(
      resulting({
        content: [
          { type: 'text', text: 'first' },
          { type: 'image', data: 'AAAA' },
          { type: 'text', text: 'second' },
        ],
      }),
    );
    const reply = await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('create_playbook', { playbook: 'sales' });
    expect(reply).toEqual({ text: 'first\nsecond', isError: false });
    expect(await sent[0]?.json()).toMatchObject({
      method: 'tools/call',
      params: { name: 'create_playbook', arguments: { playbook: 'sales' } },
    });
  });

  it('answers the error of a tool as error text, and what it answers nothing of in words', async () => {
    const failing = sending(resulting({ content: [{ type: 'text', text: 'Refused for this caller' }], isError: true }));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, failing.send).call('create_playbook', {})).toEqual({
      text: 'Refused for this caller',
      isError: true,
    });
    const silent = sending(resulting({ content: [] }));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, silent.send).call('create_playbook', {})).toEqual({
      text: ANSWERED_NOTHING,
      isError: false,
    });
  });
});

describe('a tool called at the directory that refuses or fails', () => {
  it('answers the message of a JSON-RPC error as error text', async () => {
    const { send } = sending((id) =>
      streamed({ jsonrpc: '2.0', id, error: { code: -32602, message: 'No such tool' } }),
    );
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('get_asset', {})).toEqual({
      text: 'No such tool',
      isError: true,
    });
  });

  it('answers the detail of a problem the directory refuses with, or words of its own where it says none', async () => {
    const problem = sending(
      () => new Response(JSON.stringify({ status: 403, detail: 'Not for this caller' }), { status: 403 }),
    );
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, problem.send).call('create_playbook', {})).toEqual({
      text: 'Not for this caller',
      isError: true,
    });
    const nothing = sending(() => new Response('gone', { status: 502 }));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, nothing.send).call('create_playbook', {})).toEqual({
      text: NOT_ANSWERED,
      isError: true,
    });
    const unreadable = sending(() => new Response('data: not json\n\n'));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, unreadable.send).call('create_playbook', {})).toEqual({
      text: NOT_ANSWERED,
      isError: true,
    });
  });
});

describe('a tool called at the directory with a signal, or in one JSON body', () => {
  it('sends the call with the signal it is given', async () => {
    const { send, sent } = sending(textResult('ok'));
    const given = new AbortController();
    await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('get_run', {}, given.signal);
    given.abort();
    expect(sent[0]?.signal.aborted).toBe(true);
  });

  it('reads an answer sent as one JSON body, as the directory may send one', async () => {
    const { send } = sending((id) =>
      Response.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ok' }] } }),
    );
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('list_playbooks', {})).toEqual({
      text: 'ok',
      isError: false,
    });
  });
});

describe('a result too large to send', () => {
  it('is cut at 64 KiB, and the model is told it was cut and how to ask for less', async () => {
    const { send } = sending(textResult('a'.repeat(MOST_RESULT_BYTES + 500)));
    const reply = await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('get_run', {});
    expect(reply).toEqual({ text: `${'a'.repeat(MOST_RESULT_BYTES)}\n\n${RESULT_CUT}`, isError: false });
  });

  it('stands whole at exactly the bound', async () => {
    const { send } = sending(textResult('a'.repeat(MOST_RESULT_BYTES)));
    const reply = await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('get_run', {});
    expect(reply).toEqual({ text: 'a'.repeat(MOST_RESULT_BYTES), isError: false });
  });

  it('is cut from the start of the answer, never read whole, where the answer itself is far past the bound', async () => {
    const { body, sent } = unendingStream('{"jsonrpc":"2.0","id":"x","result":{"content":[{"type":"text","text":"');
    const { send } = sending(() => new Response(body));
    const reply = await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('get_run', {});
    expect(reply).toEqual({ text: `${'b'.repeat(MOST_RESULT_BYTES)}\n\n${RESULT_CUT}`, isError: false });
    expect(sent.bytes).toBeLessThan(MOST_ANSWER_BYTES_READ * 2);
  });
});

describe('a problem’s detail too large to send', () => {
  it('is cut at 64 KiB, as an error, where the detail of a problem is longer', async () => {
    const detail = 'd'.repeat(MOST_RESULT_BYTES + 500);
    const { send } = sending(() => new Response(JSON.stringify({ status: 403, detail }), { status: 403 }));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('create_playbook', {})).toEqual({
      text: `${'d'.repeat(MOST_RESULT_BYTES)}\n\n${RESULT_CUT}`,
      isError: true,
    });
  });

  it('is never read whole where a problem document is far past the bound, and says the tool did not answer', async () => {
    const { body, sent } = unendingStream('{"status":502,"detail":"');
    const { send } = sending(() => new Response(body, { status: 502 }));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('create_playbook', {})).toEqual({
      text: NOT_ANSWERED,
      isError: true,
    });
    expect(sent.bytes).toBeLessThan(MOST_ANSWER_BYTES_READ * 2);
  });
});

describe('an error message too large to send', () => {
  it('is cut at 64 KiB, as an error, where the message of a JSON-RPC error is longer', async () => {
    const message = 'm'.repeat(MOST_RESULT_BYTES + 500);
    const { send } = sending((id) => streamed({ jsonrpc: '2.0', id, error: { code: -32602, message } }));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('get_asset', {})).toEqual({
      text: `${'m'.repeat(MOST_RESULT_BYTES)}\n\n${RESULT_CUT}`,
      isError: true,
    });
  });

  it('is cut from the start, as an error, where the message of a JSON-RPC error is far past the bound', async () => {
    const { body, sent } = unendingStream('{"jsonrpc":"2.0","id":"x","error":{"code":-32603,"message":"');
    const { send } = sending(() => new Response(body));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('get_asset', {})).toEqual({
      text: `${'b'.repeat(MOST_RESULT_BYTES)}\n\n${RESULT_CUT}`,
      isError: true,
    });
    expect(sent.bytes).toBeLessThan(MOST_ANSWER_BYTES_READ * 2);
  });
});

describe('the error mark of a result too large to send', () => {
  it('keeps the error mark of a result cut where the answer is far past the bound', async () => {
    const { body } = unendingStream(
      '{"jsonrpc":"2.0","id":"x","result":{"isError":true,"content":[{"type":"text","text":"',
    );
    const { send } = sending(() => new Response(body));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('get_run', {})).toEqual({
      text: `${'b'.repeat(MOST_RESULT_BYTES)}\n\n${RESULT_CUT}`,
      isError: true,
    });
  });

  it('keeps the error mark of a result longer than 64 KiB that was read whole', async () => {
    const { send } = sending(
      resulting({ content: [{ type: 'text', text: 'e'.repeat(MOST_RESULT_BYTES + 500) }], isError: true }),
    );
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, send).call('get_run', {})).toEqual({
      text: `${'e'.repeat(MOST_RESULT_BYTES)}\n\n${RESULT_CUT}`,
      isError: true,
    });
  });
});

describe('the listing of the directory too large to read', () => {
  it('is an error, and is never read whole', async () => {
    const sent = { bytes: 0 };
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(encoded('{"jsonrpc":"2.0","id":"x","result":{"tools":['));
      },
      pull: (controller) => {
        const chunk = encoded(' '.repeat(16_384));
        sent.bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const { send } = sending(() => new Response(body));
    await expect(directoryCallsOf(URL_OF_THE_DIRECTORY, send).tools()).rejects.toThrow(NOT_LISTED);
    expect(sent.bytes).toBeLessThan(MOST_ANSWER_BYTES_READ * 2);
  });
});

const LISTED = { tools: [{ name: 'list_playbooks', description: 'Lists them', inputSchema: { type: 'object' } }] };

describe('the answer to a call, among what the directory sends', () => {
  it('is the one of the events or of a batch whose id is the call’s, and none where nothing can be read', async () => {
    const events = sending(
      (id) =>
        new Response(
          `event: message\n\nevent: message\ndata: not json\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 'other', result: { tools: [] } })}\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: LISTED })}\n\n`,
        ),
    );
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, events.send).tools()).toEqual(LISTED.tools);
    const batch = sending((id) =>
      Response.json([
        { jsonrpc: '2.0', id: 'other' },
        { jsonrpc: '2.0', id, result: LISTED },
      ]),
    );
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, batch.send).tools()).toEqual(LISTED.tools);
    const broken = sending(() => new Response('{"jsonrpc":"2.0",'));
    await expect(directoryCallsOf(URL_OF_THE_DIRECTORY, broken.send).tools()).rejects.toThrow(NOT_LISTED);
  });
});
