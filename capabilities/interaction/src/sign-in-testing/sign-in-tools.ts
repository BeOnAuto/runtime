import { Buffer } from 'node:buffer';

import type { AnsweredOnce, CalledOnce, OneCall, ToolServer } from '@on.auto/tool-servers';
import { Effect, type Schema } from 'effect';

import { fakeTools, type FakeTools } from '../testing/fake-tools.ts';

export const signInLink = 'https://studio.example/?browser-sign-in=hand-off-7Qx2&org=acme';

const linkAnswer: Schema.JsonObject = { signed_in: false, link: signInLink, until: '2026-10-08T09:00:00.000Z' };

export interface SignInTools extends FakeTools {
  readonly signInsAsked: () => readonly OneCall[];
  readonly answerSignInWith: (answer: Schema.Json) => void;
  readonly refuseSignInArguments: (detail: string) => void;
}

const theBrowser: ToolServer = {
  name: 'browser',
  type: 'mcp',
  record_content: true,
  playbooks: ['*'],
  connection: 'conn_browser',
  provider: 'browser',
  tools: [
    {
      name: 'browser_sign_in',
      description: 'Hands the browser to the person to sign in to a site, and keeps the sign-in for them alone.',
      input_schema: { type: 'object', properties: { site: { type: 'string' } } },
      mark: 'acts',
      marked_by: 'catalogue',
    },
  ],
};

function answeredWith(answer: Schema.Json, number: number): AnsweredOnce {
  return {
    kind: 'answered',
    mark: 'acts',
    detail: '',
    retryAfterMs: null,
    outcome: 'result',
    answer: { content: [], structuredContent: answer },
    answered: {
      is_error: false,
      result_bytes: Buffer.byteLength(JSON.stringify(answer)),
      result_sha256: 'e'.repeat(64),
      duration_ms: 4,
      jsonrpc_id: number,
    },
  };
}

function refusedWith(detail: string, number: number): AnsweredOnce {
  return {
    kind: 'answered',
    mark: 'acts',
    detail,
    retryAfterMs: null,
    outcome: 'arguments_refused',
    failed: { because: 'arguments_refused', duration_ms: 4, jsonrpc_id: number },
  };
}

type Answering = (number: number) => AnsweredOnce;

export function signInTools(): SignInTools {
  const chat = fakeTools();
  const asked: OneCall[] = [];
  const next: { answering: Answering } = { answering: (number) => answeredWith(linkAnswer, number) };
  const signInCalled = (call: OneCall): Effect.Effect<CalledOnce> => {
    asked.push(call);
    return Effect.succeed(next.answering(asked.length));
  };
  return {
    ...chat,
    listServers: (address, server) =>
      Effect.map(chat.listServers(address, server), (servers) => [...servers, theBrowser]),
    named: (address, references) =>
      chat.named(
        address,
        references.filter(({ server }) => server !== theBrowser.name),
      ),
    callOnce: signInCalled,
    signInsAsked: () => [...asked],
    answerSignInWith: (answer) => {
      next.answering = (number) => answeredWith(answer, number);
    },
    refuseSignInArguments: (detail) => {
      next.answering = (number) => refusedWith(detail, number);
    },
  };
}
