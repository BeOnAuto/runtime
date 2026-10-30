import { servesPlaybook } from '@on.auto/config';
import { capitalized, type PlaybookAddress } from '@on.auto/operations';
import { Result } from 'effect';

import { ToolNotOffered } from '../access/tool-not-offered.ts';
import type { ListedTool } from '../bounds/tool-results.ts';
import type { OfferedOnServer } from '../calls/run-parts.ts';
import type { ServerSlot } from '../calls/server-slot.ts';
import type { ServerSettings } from '../settings/server-settings.ts';
import { allowsTool, isAllowed, namesEveryTool, writtenOf, type ToolReference } from './tool-reference.ts';

export interface Settled {
  readonly settings: Pick<ServerSettings, 'orgs' | 'playbooks' | 'allowed'>;
}

export interface NamingOn<Link extends Settled> {
  readonly references: readonly ToolReference[];
  readonly links: ReadonlyMap<string, Link>;
}

export interface Listed {
  readonly slot: ServerSlot;
  readonly tools: readonly ListedTool[];
}

interface NamedLink<Link extends Settled> {
  readonly reference: ToolReference;
  readonly link: Link | undefined;
}

interface ServingLink<Link extends Settled> {
  readonly reference: ToolReference;
  readonly link: Link;
}

const conjunction = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

const disjunction = new Intl.ListFormat('en', { style: 'long', type: 'disjunction' });

function notConfigured(named: readonly ToolReference[]): ToolNotOffered {
  const servers = disjunction.format(new Set(named.map(({ server }) => server)));
  return new ToolNotOffered({
    because: 'tool_server_not_configured',
    detail: `No tool server named ${servers} is configured for this playbook`,
  });
}

function notAllowed(named: readonly ToolReference[]): ToolNotOffered {
  const tools = conjunction.format(named.map((reference) => writtenOf(reference)));
  return new ToolNotOffered({
    because: 'tool_not_allowed',
    detail: `The operator of this server does not allow ${tools}`,
  });
}

function toolsNamed(references: readonly ToolReference[]): string {
  const tools = conjunction.format(references.map(({ tool }) => tool));
  return references.length === 1 ? `the tool ${tools}` : `the tools ${tools}`;
}

export function notListed(missing: readonly ToolReference[]): ToolNotOffered {
  const byServer = Map.groupBy(missing, ({ server }) => server);
  const unlisted = [...byServer].map(
    ([server, references]: readonly [string, readonly ToolReference[]]) =>
      `the tool server ${server} does not list ${toolsNamed(references)}`,
  );
  return new ToolNotOffered({ because: 'tool_not_listed', detail: capitalized(conjunction.format(unlisted)) });
}

function isServing<Link extends Settled>(named: NamedLink<Link>, address: PlaybookAddress): named is ServingLink<Link> {
  return named.link !== undefined && servesPlaybook(named.link.settings, address);
}

export function namedLinks<Link extends Settled>(
  address: PlaybookAddress,
  { references, links }: NamingOn<Link>,
): Result.Result<readonly Link[], ToolNotOffered> {
  const named = references.map((reference): NamedLink<Link> => ({ reference, link: links.get(reference.server) }));
  const unconfigured = named.filter((each) => !isServing(each, address));
  if (unconfigured.length > 0) {
    return Result.fail(notConfigured(unconfigured.map(({ reference }) => reference)));
  }
  const serving = named.filter((each) => isServing(each, address));
  const disallowed = serving.filter(({ reference, link }) => !isAllowed(reference, link.settings.allowed));
  if (disallowed.length > 0) {
    return Result.fail(notAllowed(disallowed.map(({ reference }) => reference)));
  }
  return Result.succeed([...new Set(serving.map(({ link }) => link))]);
}

export interface Offering {
  readonly references: readonly ToolReference[];
}

function namedOn({ slot }: Listed, naming: Offering): readonly ToolReference[] {
  return naming.references.filter((reference) => reference.server === slot.settings.name);
}

export function offeredOn(listed: Listed, naming: Offering): readonly OfferedOnServer[] {
  const named = namedOn(listed, naming);
  const { slot } = listed;
  const server = slot.settings.name;
  return listed.tools
    .filter((tool) =>
      named.some((reference) =>
        namesEveryTool(reference) ? allowsTool(slot.settings.allowed, tool.name) : reference.tool === tool.name,
      ),
    )
    .map((tool) => ({ slot, reference: { server, tool: tool.name }, tool }));
}

export function unlistedOn(listed: Listed, naming: Offering): readonly ToolReference[] {
  return namedOn(listed, naming).filter(
    (reference) => !namesEveryTool(reference) && !listed.tools.some(({ name }) => name === reference.tool),
  );
}
