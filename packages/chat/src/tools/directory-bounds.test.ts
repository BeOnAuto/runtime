import { describe, expect, it } from 'vitest';

import { RESULT_CUT, resultCut } from './bounded-answer.ts';
import { directoryCallsOf, NOT_LISTED, type SendToDirectory } from './directory-calls.ts';

const URL_OF_THE_DIRECTORY = 'https://runtime.example/directory';

function sending(answer: (id: string) => Response) {
  const send: SendToDirectory = async (request) => {
    const asked: unknown = await request.json();
    const message = typeof asked === 'object' && asked !== null ? Object.fromEntries(Object.entries(asked)) : {};
    return answer(String(message['id']));
  };
  return { send };
}

const streamed = (message: unknown) => new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`);

const textResult = (text: string) => (id: string) =>
  streamed({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });

describe('the bounds of a call to the directory as parameters', () => {
  it('cut a result, a problem’s detail and a JSON-RPC error’s message at the bytes they are given', async () => {
    const bounds = { resultBytes: 3, answerBytesRead: 1_024 };
    const result = sending(textResult('abcdef'));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, result.send, bounds).call('get_run', {})).toEqual({
      text: `abc\n\n${resultCut(3)}`,
      isError: false,
    });
    const problem = sending(() => new Response(JSON.stringify({ status: 403, detail: 'defghi' }), { status: 403 }));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, problem.send, bounds).call('get_run', {})).toEqual({
      text: `def\n\n${resultCut(3)}`,
      isError: true,
    });
    const error = sending((id) => streamed({ jsonrpc: '2.0', id, error: { code: -32602, message: 'ghijkl' } }));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, error.send, bounds).call('get_run', {})).toEqual({
      text: `ghi\n\n${resultCut(3)}`,
      isError: true,
    });
  });

  it('read an answer no further than the bytes they are given', async () => {
    const answered = `{"jsonrpc":"2.0","id":"x","result":{"content":[{"type":"text","text":"${'b'.repeat(64)}"}]}}`;
    const { send } = sending(() => new Response(answered));
    expect(await directoryCallsOf(URL_OF_THE_DIRECTORY, send, { answerBytesRead: 80 }).call('get_run', {})).toEqual({
      text: `${'b'.repeat(80 - answered.indexOf('b'))}\n\n${RESULT_CUT}`,
      isError: false,
    });
    const listing = sending(() => new Response(answered));
    await expect(directoryCallsOf(URL_OF_THE_DIRECTORY, listing.send, { answerBytesRead: 8 }).tools()).rejects.toThrow(
      NOT_LISTED,
    );
  });
});
