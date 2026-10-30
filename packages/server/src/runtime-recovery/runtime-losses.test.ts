import { SdkError, SdkErrorCode } from '@modelcontextprotocol/client';
import { serverStopping, stoppedWords } from '@on.auto/api';
import { describe, expect, it } from 'vitest';

import { cutOffMidAnswer, refusedAtConnect, turnedAwayWith } from '../testing/relays/fake-runtime.ts';
import { isTheStopAnswer, lossOf, saidOf, type Loss } from './runtime-losses.ts';

const notARuntime = new SdkError(SdkErrorCode.ClientHttpUnexpectedContent, 'Unexpected content type: text/html');

describe('what a failed request met', () => {
  it.each<readonly [string, unknown, Loss]>([
    ['a refused connection, which it never got past', refusedAtConnect, 'refused'],
    [
      'a server that stops, before it handled the request',
      turnedAwayWith(503, JSON.stringify(serverStopping)),
      'refused',
    ],
    [
      'a server that is unavailable for another reason',
      turnedAwayWith(503, JSON.stringify({ ...serverStopping, detail: 'The ledger cannot serve now' })),
      'stopped',
    ],
    ['a credential asked for', turnedAwayWith(401), 'turned away'],
    ['a request refused as malformed', turnedAwayWith(400), 'turned away'],
    ['an answer that is no MCP answer', notARuntime, 'turned away'],
    ['a failing server', turnedAwayWith(502), 'stopped'],
    ['an answer cut off', cutOffMidAnswer, 'stopped'],
    ['any other failure', new Error('the socket hung up'), 'stopped'],
  ])('is read from %s', (_case, failure, loss) => {
    expect(lossOf(failure)).toBe(loss);
  });
});

describe('what the runtime said when it turned a request away', () => {
  it.each<readonly [string, unknown, string]>([
    [
      'the detail of its problem',
      turnedAwayWith(413, JSON.stringify({ title: 'Content too large', detail: 'The body is larger than 1 MiB' })),
      'Auto Runtime turned this request away: The body is larger than 1 MiB',
    ],
    [
      'the message of its JSON-RPC error',
      turnedAwayWith(
        400,
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32_600, message: 'Unsupported protocol version' } }),
      ),
      'Auto Runtime turned this request away: Unsupported protocol version',
    ],
    [
      'its status, when it said nothing more',
      turnedAwayWith(404),
      'Auto Runtime turned this request away with HTTP 404',
    ],
    [
      'its status, when what it said is no problem',
      turnedAwayWith(400, '<html>no</html>'),
      'Auto Runtime turned this request away with HTTP 400',
    ],
    [
      'that its answer is no MCP answer',
      notARuntime,
      'Auto Runtime answered this request with content that is no MCP answer',
    ],
    ['what failed, for any other failure', refusedAtConnect, 'TypeError: fetch failed'],
  ])('is %s', (_case, failure, said) => {
    expect(saidOf(failure)).toBe(said);
  });
});

describe('the answer of a runtime that stopped while it handled a request', () => {
  it('is its JSON-RPC error with the words of its endpoint, and no other answer', () => {
    expect([
      isTheStopAnswer({ jsonrpc: '2.0', id: 3, error: { code: -32_603, message: stoppedWords } }),
      isTheStopAnswer({ jsonrpc: '2.0', id: 3, error: { code: -32_603, message: 'Something else failed' } }),
      isTheStopAnswer({ jsonrpc: '2.0', id: 3, error: { code: -32_602, message: stoppedWords } }),
      isTheStopAnswer({ jsonrpc: '2.0', id: 3, result: {} }),
    ]).toEqual([true, false, false, false]);
  });
});
