import { noStrippedForms, type StrippedForms } from '@on.auto/definitions';
import { issueText } from '@on.auto/definitions/document';
import {
  InvalidInput,
  OperationsServed,
  type Choice,
  type Issue,
  type Options,
  type PlaybookAddress,
} from '@on.auto/operations';
import { requestCarriersAmong, type RequestCarrier } from '@on.auto/tool-servers';
import { Effect, Struct } from 'effect';

import { reachInWords, throughInWords, type Reach } from '../capability/request-way-words.ts';
import type { WayPorts } from '../capability/request-ways.ts';
import type { SignInDocument, SignInQuestion } from '../document/interaction-document.ts';
import { forAnAgent } from '../tool-blocks/tool-block-schemas.ts';

interface Unsaid {
  readonly question: SignInQuestion;
  readonly line: number;
  readonly site: string;
}

const pointerOfTheQuestion: Readonly<Record<SignInQuestion, string>> = {
  if_signed_out: '/sign_in/if_signed_out',
  deliver: '/deliver',
  expires: '/expires',
};

function issuesAt({ question, line }: Unsaid, detail: string): readonly Issue[] {
  return [{ pointer: '', detail: issueText({ line, pointer: pointerOfTheQuestion[question], detail }) }];
}

function refusalOf(unsaid: Unsaid, detail: string, options: Options): InvalidInput {
  return new InvalidInput({
    detail: 'The interaction function definition has a problem',
    issues: issuesAt(unsaid, detail),
    options,
  });
}

function ifSignedOutRefusal(unsaid: Unsaid): InvalidInput {
  const { site } = unsaid;
  return refusalOf(
    unsaid,
    `sign_in.if_signed_out is required: ask the person whether a run waits for them to sign in to ${site}, ask, or stops at once, fail`,
    {
      question: `When you're not signed in to ${site}, should a run wait for you?`,
      choices: [
        {
          value: 'ask',
          title: 'Wait for me to sign in',
          issues: issuesAt(
            unsaid,
            'Write sign_in.if_signed_out: ask, with deliver, expires and the message that asks them',
          ),
        },
        {
          value: 'fail',
          title: 'Stop at once',
          issues: issuesAt(unsaid, 'Write sign_in.if_signed_out: fail, with no deliver, expires or message'),
        },
      ],
    },
  );
}

const waits: readonly (readonly [string, string])[] = [
  ['PT1H', 'An hour'],
  ['P1D', 'A day'],
  ['P7D', 'A week'],
];

function expiresRefusal(unsaid: Unsaid): InvalidInput {
  return refusalOf(
    unsaid,
    'expires is required with if_signed_out: ask: ask the person how long a run waits for them to sign in, an ISO 8601 duration from one minute to thirty days, such as P1D',
    {
      question: `How long should a run wait for you to sign in to ${unsaid.site}?`,
      choices: waits.map(([value, title]) => ({ value, title, issues: issuesAt(unsaid, `Write expires: ${value}`) })),
    },
  );
}

const theAgentWay = `Write deliver: ${forAnAgent}: Studio lists the request for the person, and their agent reads it with list_interactions`;

function carrierChoice(unsaid: Unsaid, carrier: RequestCarrier): Choice {
  const { server, connection } = carrier;
  return {
    value: `${connection === undefined ? 'tool_server' : 'connection'}:${server}`,
    title: server,
    issues: issuesAt(unsaid, throughInWords(carrier)),
  };
}

function deliverRefusal(unsaid: Unsaid, reach: Reach): InvalidInput {
  const carriers = requestCarriersAmong(reach.servers).map((carrier) => Struct.omit(carrier, ['reading']));
  const asked = { party: 'the person', line: unsaid.line, answered: false, saidForAnAgent: false };
  return refusalOf(
    unsaid,
    `Say how the person is reached when a run asks them to sign in: deliver names the tool of a connection that sends the request, or deliver: ${forAnAgent} holds it for Studio and their agent. ${reachInWords(asked, carriers, reach)}`,
    {
      question: `Where should a run ask you to sign in to ${unsaid.site}?`,
      choices: [
        ...carriers.map((carrier) => carrierChoice(unsaid, carrier)),
        { value: forAnAgent, title: 'Studio or your agent', issues: issuesAt(unsaid, theAgentWay) },
      ],
    },
  );
}

function deliverAsked(ports: WayPorts, unsaid: Unsaid, place: PlaybookAddress) {
  return Effect.gen(function* () {
    const servers = yield* ports.listServers(place);
    const serves = yield* OperationsServed;
    const connectsHere = serves('search') && serves('add_connection');
    return yield* Effect.fail(
      deliverRefusal(unsaid, { servers, takesConnections: ports.takesConnections, connectsHere }),
    );
  });
}

export function signInCheck(
  ports: WayPorts,
): (document: SignInDocument, place: PlaybookAddress) => Effect.Effect<StrippedForms, InvalidInput> {
  return ({ whenSignedOut, signIn }, place) => {
    if (whenSignedOut.answer !== 'unsaid') {
      return Effect.succeed(noStrippedForms);
    }
    const unsaid = { question: whenSignedOut.question, line: whenSignedOut.line, site: signIn.site };
    if (unsaid.question === 'deliver') {
      return deliverAsked(ports, unsaid, place);
    }
    return Effect.fail(unsaid.question === 'expires' ? expiresRefusal(unsaid) : ifSignedOutRefusal(unsaid));
  };
}
