import type { Issue } from '@on.auto/operations';
import { alternatives } from '@on.auto/phrasing';
import { EventsByHandSchema, toolsNamedIn, type EventsByHand } from '@on.auto/providers';
import { Schema, SchemaTransformation } from 'effect';

import { bytesOfText, mostEventsBytes } from '../registry/connection-entry.ts';

const eventsWords = {
  description:
    "Without a provider, give this when the service can send webhooks, so Auto knows at once when someone replies. Name the tools that register and remove Auto's webhook URL, and say how to verify webhooks and which ones are replies. The guide connect-a-service shows how. Never put a secret in it.",
  tooLarge: (bytes: number) =>
    `events is ${bytes.toLocaleString('en-US')} bytes as JSON, and the most it may be is ${mostEventsBytes.toLocaleString('en-US')}. Keep only what the service's documentation calls for`,
  ofAProvider:
    'Expected no events when provider is given: leave events out, because only a connection added without a provider takes it',
  notATool: (tools: readonly string[]) =>
    `Expected a tool of this connection: ${alternatives(tools)}. If the call you need is one of these, use its name. If it is not, add the call to document_text when you wrote that document and the service's documentation has the call, and leave events out when you cannot`,
  notAllowed: (tools: readonly string[]) =>
    `Expected a tool that entry.allowed lists: ${alternatives(tools)}. Name one of these here, or add this tool to entry.allowed`,
} as const;

function sizeIssueOf(events: Readonly<Record<string, Schema.Json>>): string | undefined {
  const bytes = bytesOfText(JSON.stringify(events));
  return bytes > mostEventsBytes ? eventsWords.tooLarge(bytes) : undefined;
}

export const AddedEventsSchema = Schema.Record(Schema.String, Schema.Json)
  .annotate({ description: eventsWords.description })
  .check(Schema.makeFilter(sizeIssueOf))
  .pipe(Schema.decodeTo(EventsByHandSchema, SchemaTransformation.passthrough()));

export const eventsOfAProvider: Schema.FilterIssue = { path: ['events'], issue: eventsWords.ofAProvider };

interface Untaken {
  readonly path: readonly (string | number)[];
  readonly detail: string;
}

function untakenIn(
  destinations: EventsByHand['destinations'],
  tools: readonly string[],
  detail: string,
): readonly Untaken[] {
  return toolsNamedIn({ destinations })
    .filter(({ tool }) => !tools.includes(tool))
    .map(({ path }) => ({ path: ['events', ...path], detail }));
}

export function unallowedToolsIn(
  { destinations }: EventsByHand,
  allowed: readonly string[],
): readonly Schema.FilterIssue[] {
  return untakenIn(destinations, allowed, eventsWords.notAllowed(allowed)).map(({ path, detail }) => ({
    path,
    issue: detail,
  }));
}

export function undeclaredToolsIn({ destinations }: EventsByHand, tools: readonly string[]): readonly Issue[] {
  return untakenIn(destinations, tools, eventsWords.notATool(tools)).map(({ path, detail }) => ({
    pointer: `/${path.join('/')}`,
    detail,
  }));
}
