import { noStrippedForms, type StrippedForms } from '@on.auto/definitions';
import { issueText } from '@on.auto/definitions/document';
import { InvalidInput, OperationsServed, type Choice, type Issue, type PlaybookAddress } from '@on.auto/operations';
import { requestCarriersAmong, type RequestCarrier, type ToolAccess } from '@on.auto/tool-servers';
import { Effect, Struct } from 'effect';

import type { InteractionFunctionDefinitionDocument } from '../document/interaction-document.ts';
import { forAnAgent } from '../tool-blocks/tool-block-schemas.ts';
import {
  agentWayInWords,
  partyInWords,
  questionOf,
  reachInWords,
  throughInWords,
  wayInWords,
  type Reach,
  type WayAsked,
} from './request-way-words.ts';

export type WayPorts = Pick<ToolAccess, 'listServers' | 'takesConnections'>;

function issueOf({ line }: WayAsked, detail: string): readonly Issue[] {
  return [{ pointer: '', detail: issueText({ line, pointer: '/deliver', detail }) }];
}

function carrierChoice(asked: WayAsked, carrier: RequestCarrier): Choice {
  const { server, connection } = carrier;
  return {
    value: `${connection === undefined ? 'tool_server' : 'connection'}:${server}`,
    title: server,
    issues: issueOf(asked, throughInWords(carrier)),
  };
}

function agentChoice(asked: WayAsked): Choice {
  return { value: forAnAgent, title: 'An agent, such as this one', issues: issueOf(asked, agentWayInWords) };
}

function carriersFor({ answered }: WayAsked, carriers: readonly RequestCarrier[]): readonly RequestCarrier[] {
  return answered
    ? carriers.filter(({ reading }) => reading !== undefined)
    : carriers.map((carrier) => Struct.omit(carrier, ['reading']));
}

function refusalOf(asked: WayAsked, reach: Reach): InvalidInput {
  const carriers = carriersFor(asked, requestCarriersAmong(reach.servers));
  const choices = [
    ...carriers.map((carrier) => carrierChoice(asked, carrier)),
    ...(asked.answered ? [agentChoice(asked)] : []),
  ];
  return new InvalidInput({
    detail: 'The interaction function definition has a problem',
    issues: issueOf(asked, `${wayInWords(asked)} ${reachInWords(asked, carriers, reach)}`),
    ...(choices.length === 0 ? {} : { options: { question: questionOf(asked), choices } }),
  });
}

function wayAskedIn(document: InteractionFunctionDefinitionDocument): WayAsked | undefined {
  if (document.shape !== 'request' || document.heldForAnAgent === undefined) {
    return undefined;
  }
  const answered = document.output.schema !== undefined;
  const { said, line } = document.heldForAnAgent;
  return said && answered ? undefined : { party: partyInWords(document.to), line, answered, saidForAnAgent: said };
}

export function wayCheck(
  ports: WayPorts,
): (
  document: InteractionFunctionDefinitionDocument,
  source: string,
  place: PlaybookAddress,
) => Effect.Effect<StrippedForms, InvalidInput> {
  return (document, _source, place) => {
    const asked = wayAskedIn(document);
    if (asked === undefined) {
      return Effect.succeed(noStrippedForms);
    }
    return Effect.gen(function* () {
      const servers = yield* ports.listServers(place);
      const serves = yield* OperationsServed;
      const connectsHere = serves('search') && serves('add_connection');
      return yield* Effect.fail(refusalOf(asked, { servers, takesConnections: ports.takesConnections, connectsHere }));
    });
  };
}
