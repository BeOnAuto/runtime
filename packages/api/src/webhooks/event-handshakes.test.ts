import { createHmac } from 'node:crypto';

import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  eventsPath,
  eventsServedWith,
  roomHeaders,
  rooms,
  roomsSecret,
  tickets,
  ticketsSecret,
} from '../testing/delivered-events.ts';
import { deliveryProblems } from './delivery-problems.ts';

type Handler = ReturnType<typeof eventsServedWith>['handler'];

interface Answer {
  readonly status: number;
  readonly type: string | null;
  readonly text: string;
}

interface Sent {
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

async function answered(handler: Handler, path: string, init: Sent = {}): Promise<Answer> {
  const answer = await handler.fetch(new Request(`http://localhost${path}`, { method: 'POST', ...init }));
  return { status: answer.status, type: answer.headers.get('content-type'), text: await answer.text() };
}

const askedToSubscribe = `${eventsPath('tickets')}?hub.mode=subscribe&hub.topic=project-3&hub.challenge=first&hub.challenge=second`;

const check = JSON.stringify({ kind: 'address_check', check: { token: 'check-token-5' } });

function roomCheck(handler: Handler, body = check, secret = roomsSecret) {
  return answered(handler, eventsPath('rooms'), { headers: roomHeaders(body, { secret }), body });
}

const refusal = { status: 401, type: 'application/problem+json', text: await deliveryProblems.unsigned().text() };

describe('a handshake its entry says comes before any secret', () => {
  it('is answered with its challenge as text before any proof, no secret asked and nothing handed on', async () => {
    const { handler, served } = eventsServedWith();

    const answer = await answered(handler, askedToSubscribe, { headers: { 'x-tracker-signature': 'sha256=zz' } });

    expect(answer).toEqual({ status: 200, type: 'text/plain; charset=utf-8', text: 'first' });
    expect(served.asked).toEqual(['destination of tickets']);
    expect(served.arrived).toEqual([]);
    expect(served.heard.map(({ outcome }) => outcome)).toEqual(['handshake']);
  });

  it('is refused where it names no challenge, or where its answer asks for an hmac, which a stranger could have made of anything', async () => {
    const handshake = {
      when: { '$request.query.hub.mode': ['subscribe'] },
      challenge: '$request.query.hub.challenge',
      response: { challenge: 'challenge', proof: 'hmac' },
      signed: false,
    } as const;
    const { handler, served } = eventsServedWith({ destination: () => Promise.resolve({ ...tickets, handshake }) });

    const answers = [
      await answered(handler, `${eventsPath('tickets')}?hub.mode=subscribe`),
      await answered(handler, askedToSubscribe),
    ];

    expect(answers).toEqual([refusal, refusal]);
    expect(served.asked.filter((asked) => asked.startsWith('secrets'))).toEqual([]);
    expect(served.heard.map(({ outcome }) => outcome)).toEqual(['malformed', 'unsigned']);
  });
});

describe('a handshake its entry says is signed', () => {
  it('is refused as any delivery is until it is proven, and answered once proven, its hmac made with the secret that proved it', async () => {
    const { handler, served } = eventsServedWith({
      secrets: () => Promise.resolve([Redacted.make(ticketsSecret), Redacted.make(roomsSecret)]),
    });
    const proof = createHmac('sha256', roomsSecret).update('check-token-5').digest('base64');

    const answers = [await roomCheck(handler, check, 'a secret of another app'), await roomCheck(handler)];

    expect(answers).toEqual([
      refusal,
      { status: 200, type: 'application/json', text: JSON.stringify({ token: 'check-token-5', proof }) },
    ]);
    expect(served.arrived).toEqual([]);
    expect(served.heard.map(({ outcome }) => outcome)).toEqual(['mismatched', 'handshake']);
  });

  it('is answered with its challenge as text where its entry declares no answer, and refused where it names none', async () => {
    const answeredAsText = {
      when: { '$request.body#/kind': ['address_check'] },
      challenge: '$request.body#/check/token',
      signed: true,
    };
    const { handler, served } = eventsServedWith({
      destination: () => Promise.resolve({ ...rooms, handshake: answeredAsText }),
    });
    const unnamed = JSON.stringify({ kind: 'address_check', check: {} });

    const answers = [await roomCheck(handler), await roomCheck(handler, unnamed)];

    expect(answers).toEqual([{ status: 200, type: 'text/plain; charset=utf-8', text: 'check-token-5' }, refusal]);
    expect(served.heard.map(({ outcome }) => outcome)).toEqual(['handshake', 'malformed']);
  });
});
