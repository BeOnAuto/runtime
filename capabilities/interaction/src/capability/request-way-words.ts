import type { ParsedTemplate } from '@on.auto/definitions/template';
import { alternatives, quoted } from '@on.auto/operations';
import { unavailableInWords, type RequestCarrier, type ToolServer } from '@on.auto/tool-servers';

import { forAnAgent } from '../tool-blocks/tool-block-schemas.ts';

export interface WayAsked {
  readonly party: string;
  readonly line: number;
  readonly answered: boolean;
  readonly saidForAnAgent: boolean;
}

export interface Reach {
  readonly servers: readonly ToolServer[];
  readonly takesConnections: boolean;
  readonly connectsHere: boolean;
}

const oneInputValue = /^\{\{\s*input\.(?<name>[A-Za-z_]\w*)\s*\}\}$/u;

const templateSyntax = /\{\{|\{%/u;

export function partyInWords({ text }: Pick<ParsedTemplate, 'text'>): string {
  const written = text.trim();
  const name = oneInputValue.exec(written)?.groups?.['name'];
  if (name !== undefined) {
    return `the ${name.replaceAll('_', ' ')}`;
  }
  return templateSyntax.test(written) ? 'the person' : written;
}

const theAgentWay = `deliver: ${forAnAgent} holds the request for an agent, which reads it with list_interactions and answers it with answer_interaction`;

const throughAConnection = 'it goes through a connection, deliver naming the tool that sends it';

export function wayInWords({ party, answered, saidForAnAgent }: WayAsked): string {
  if (answered) {
    return `Say how ${party} is reached: deliver names the tool of a connection that sends the request, with replies naming its tool that reads the replies, or ${theAgentWay}.`;
  }
  return saidForAnAgent
    ? `A notification takes no answer, so no agent holds it: ${throughAConnection}.`
    : `Say how ${party} is reached: a notification takes no answer, so ${throughAConnection}.`;
}

function carrierInWords({ server, connection, sending, reading }: RequestCarrier): string {
  const kind = connection === undefined ? 'the tool server' : 'the connection';
  return `${kind} ${server} (${reading === undefined ? sending : `${sending}, ${reading}`})`;
}

function connectingInWords({ takesConnections, connectsHere }: Reach, carried: boolean): readonly string[] {
  if (!takesConnections) {
    return carried ? [] : ['whoever runs this server can set one up'];
  }
  if (connectsHere) {
    return [
      carried
        ? 'a connection can also be added with search and add_connection'
        : 'one can be connected with search and add_connection',
    ];
  }
  return [
    carried ? 'a person can also add a connection to the org' : 'a person can add one to the org as a connection',
  ];
}

function noneInWords({ servers }: Reach, can: string): string {
  return servers.length === 0
    ? 'No connection or tool server serves this playbook'
    : `No connection or tool server of this playbook has tools that can ${can}`;
}

function unavailableAmong({ servers }: Reach): readonly string[] {
  return servers.flatMap((server) =>
    'unavailable' in server ? [unavailableInWords(server, quoted(server.name))] : [],
  );
}

export function reachInWords(asked: WayAsked, carriers: readonly RequestCarrier[], reach: Reach): string {
  const can = asked.answered ? 'send a request and read its replies' : 'send it';
  const carried = carriers.length > 0;
  const reached = carried
    ? `This playbook can ${can} through ${alternatives(carriers.map((carrier) => carrierInWords(carrier)))}`
    : noneInWords(reach, can);
  const connecting = carriers.some(({ connection }) => connection !== undefined)
    ? []
    : connectingInWords(reach, carried);
  return [`${[reached, ...connecting].join('; ')}.`, ...(carried ? [] : unavailableAmong(reach))].join(' ');
}

export function throughInWords({ server, sending, reading }: RequestCarrier): string {
  const deliver = `Deliver through ${server}: write deliver with server ${server} and tool ${sending}`;
  return reading === undefined
    ? `${deliver}; learn what it takes with introspect, and call it with execute once the person agrees.`
    : `${deliver}, its sent pointing into what ${sending} answers, and replies with tool ${reading}; learn what each tool takes with introspect, and call ${sending} with execute once the person agrees.`;
}

export function questionOf({ party, answered }: WayAsked): string {
  return answered ? `Where should ${party} be asked?` : `Where should ${party} be told?`;
}

export const agentWayInWords = `Write deliver: ${forAnAgent}; an agent reads the request with list_interactions and answers it with answer_interaction.`;
