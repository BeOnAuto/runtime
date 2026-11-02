import { bytesOfReference, holdsNoForbiddenCharacter, mostReferenceBytes } from '@on.auto/operations';

import {
  countPattern,
  definitionsSegment,
  isDefinition,
  isPlaybookId,
  isVersion,
  orgSegment,
  playbooksSegment,
  runsSegment,
  uuidPattern,
} from './activity-addresses.ts';

export const mostAddressCharacters = 512;

const stepsSegment = 'steps';

const eventsSegment = 'events';

const resultSegment = 'result';

const partsSegment = 'parts';

const connectionsSegment = 'connections';

const membersSegment = 'members';

const settingsSegment = 'settings';

const workflowType = 'workflow';

const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_[1-9][0-9]{0,8})?$/u;

const partPattern = /^[a-z][a-z0-9-]{0,63}$/u;

const memberPattern = /^[A-Za-z0-9_-]{1,64}$/u;

const whiteSpace = /\s/u;

interface DefinitionAtVersion {
  readonly type: string;
  readonly name: string;
  readonly version: number;
}

interface Parted {
  readonly part?: string;
}

type OfThePlaybook =
  | ({ readonly kind: 'playbook'; readonly playbook: string } & Parted)
  | ({ readonly kind: 'definition'; readonly playbook: string } & DefinitionAtVersion & Parted)
  | ({ readonly kind: 'step'; readonly playbook: string; readonly step: string } & DefinitionAtVersion)
  | ({ readonly kind: 'run'; readonly playbook: string; readonly run: string } & Parted)
  | { readonly kind: 'event'; readonly playbook: string; readonly run: string; readonly event: string }
  | { readonly kind: 'block'; readonly playbook: string; readonly run: string; readonly block: number }
  | { readonly kind: 'request'; readonly playbook: string; readonly run: string };

export type OfTheOrg =
  | ({ readonly kind: 'org' } & Parted)
  | ({ readonly kind: 'connection'; readonly connection: string } & Parted)
  | ({ readonly kind: 'member'; readonly member: string } & Parted)
  | ({ readonly kind: 'settings'; readonly page: string } & Parted);

export type CommentTarget = OfThePlaybook | OfTheOrg;

interface EveryVersion {
  readonly kind: 'every_version';
  readonly playbook: string;
  readonly type: string;
  readonly name: string;
}

export type ListedTarget = CommentTarget | EveryVersion;

type Place = (playbook: string, segments: readonly string[]) => ListedTarget | undefined;

function isWellFormed(address: string): boolean {
  return (
    address.length <= mostAddressCharacters &&
    !whiteSpace.test(address) &&
    holdsNoForbiddenCharacter(address) &&
    address.split('/').every((part) => part !== '')
  );
}

function partedOf(rest: readonly string[]): Parted | undefined {
  const [parts, part = '', ...beyond] = rest;
  if (parts === undefined) {
    return {};
  }
  return parts === partsSegment && beyond.length === 0 && partPattern.test(part) ? { part } : undefined;
}

function parted<T extends ListedTarget>(target: T, rest: readonly string[]): (T & Parted) | undefined {
  const part = partedOf(rest);
  return part === undefined ? undefined : { ...target, ...part };
}

function isStep(step: readonly string[]): boolean {
  return step.length > 0 && bytesOfReference(`/${step.join('/')}`) <= mostReferenceBytes;
}

function atVersionPlace(playbook: string, type: string, name: string, [version = '', ...rest]: readonly string[]) {
  const atVersion = { playbook, type, name, version: Number(version) };
  const [steps, ...step] = rest;
  return type === workflowType && steps === stepsSegment && isStep(step)
    ? ({ kind: 'step', ...atVersion, step: step.join('/') } satisfies ListedTarget)
    : parted({ kind: 'definition', ...atVersion } satisfies ListedTarget, rest);
}

function versionsPlace(
  playbook: string,
  type: string,
  name: string,
  rest: readonly string[],
): ListedTarget | undefined {
  const [version = ''] = rest;
  if (rest.length === 0) {
    return { kind: 'every_version', playbook, type, name };
  }
  return isVersion(version) ? atVersionPlace(playbook, type, name, rest) : undefined;
}

const definitionPlace: Place = (playbook, [type = '', name = '', ...rest]) =>
  isDefinition(type, name) ? versionsPlace(playbook, type, name, rest) : undefined;

function partOfRun(playbook: string, run: string, rest: readonly string[]): ListedTarget | undefined {
  const [part, id = ''] = rest;
  if (part === eventsSegment && eventIdPattern.test(id)) {
    return { kind: 'event', playbook, run, event: id };
  }
  return part === resultSegment && countPattern.test(id)
    ? { kind: 'block', playbook, run, block: Number(id) }
    : parted({ kind: 'run', playbook, run } satisfies ListedTarget, rest);
}

const runPlace: Place = (playbook, [run = '', ...rest]) =>
  uuidPattern.test(run) && rest.length <= 2 ? partOfRun(playbook, run, rest) : undefined;

const places: Readonly<Record<string, Place>> = { [definitionsSegment]: definitionPlace, [runsSegment]: runPlace };

function placeIn(playbook: string, [segment = '', ...segments]: readonly string[]): ListedTarget | undefined {
  const place = Object.hasOwn(places, segment) ? places[segment] : undefined;
  return place?.(playbook, segments);
}

type OrgPlace = (id: string, rest: readonly string[]) => OfTheOrg | undefined;

const theOrgItself = '';

const orgPlaces: Readonly<Record<string, OrgPlace>> = {
  [theOrgItself]: () => ({ kind: 'org' }),
  [partsSegment]: (part, rest) => parted({ kind: 'org' }, [partsSegment, part, ...rest]),
  [connectionsSegment]: (connection, rest) =>
    uuidPattern.test(connection) ? parted({ kind: 'connection', connection }, rest) : undefined,
  [membersSegment]: (member, rest) =>
    memberPattern.test(member) ? parted({ kind: 'member', member }, rest) : undefined,
  [settingsSegment]: (page, rest) => (partPattern.test(page) ? parted({ kind: 'settings', page }, rest) : undefined),
};

function orgPlaceOf([first, segment = theOrgItself]: readonly string[]): OrgPlace | undefined {
  return first === orgSegment && Object.hasOwn(orgPlaces, segment) ? orgPlaces[segment] : undefined;
}

function playbookPlace(rest: readonly string[]): ListedTarget | undefined {
  const [playbook = '', ...beyond] = rest;
  return isPlaybookId(playbook) ? parted({ kind: 'playbook', playbook }, beyond) : undefined;
}

function listedTargetIn(segments: readonly string[]): ListedTarget | undefined {
  const [first = '', ...rest] = segments;
  const [second = ''] = rest;
  if (rest.length === 1 && uuidPattern.test(second)) {
    return isPlaybookId(first) ? { kind: 'request', playbook: first, run: second } : undefined;
  }
  const orgPlace = orgPlaceOf(segments);
  if (orgPlace !== undefined) {
    const [, id = '', ...beyond] = rest;
    return orgPlace(id, beyond);
  }
  if (first === playbooksSegment) {
    return playbookPlace(rest);
  }
  return isPlaybookId(first) ? placeIn(first, rest) : undefined;
}

export function listedTargetOf(address: string): ListedTarget | undefined {
  return isWellFormed(address) ? listedTargetIn(address.split('/')) : undefined;
}

export function commentTargetOf(address: string): CommentTarget | undefined {
  const target = listedTargetOf(address);
  return target?.kind === 'every_version' ? undefined : target;
}

export function playbookOfTarget(target: ListedTarget): string | undefined {
  return 'playbook' in target ? target.playbook : undefined;
}

function definitionAddressOf(playbook: string, { type, name, version }: DefinitionAtVersion): string {
  return `${playbook}/${definitionsSegment}/${type}/${name}/${version}`;
}

function runAddressOf(playbook: string, run: string): string {
  return `${playbook}/${runsSegment}/${run}`;
}

function definitionTargetAddress(target: Extract<ListedTarget, { kind: 'definition' | 'step' }>): string {
  const atVersion = definitionAddressOf(target.playbook, target);
  return target.kind === 'step' ? `${atVersion}/${stepsSegment}/${target.step}` : atVersion;
}

function runTargetAddress(target: Extract<ListedTarget, { kind: 'run' | 'event' | 'block' }>): string {
  const run = runAddressOf(target.playbook, target.run);
  if (target.kind === 'event') {
    return `${run}/${eventsSegment}/${target.event}`;
  }
  return target.kind === 'block' ? `${run}/${resultSegment}/${target.block}` : run;
}

function orgTargetAddress(target: OfTheOrg): string {
  if (target.kind === 'connection') {
    return `${orgSegment}/${connectionsSegment}/${target.connection}`;
  }
  if (target.kind === 'member') {
    return `${orgSegment}/${membersSegment}/${target.member}`;
  }
  return target.kind === 'settings' ? `${orgSegment}/${settingsSegment}/${target.page}` : orgSegment;
}

function thingTargetAddress(target: ListedTarget): string {
  if (target.kind === 'playbook') {
    return `${playbooksSegment}/${target.playbook}`;
  }
  if (target.kind === 'request') {
    return `${target.playbook}/${target.run}`;
  }
  if (target.kind === 'every_version') {
    return `${target.playbook}/${definitionsSegment}/${target.type}/${target.name}`;
  }
  if (target.kind === 'definition' || target.kind === 'step') {
    return definitionTargetAddress(target);
  }
  return target.kind === 'run' || target.kind === 'event' || target.kind === 'block'
    ? runTargetAddress(target)
    : orgTargetAddress(target);
}

function partOf(target: ListedTarget): string | undefined {
  return 'part' in target ? target.part : undefined;
}

export function addressOfTarget(target: ListedTarget): string {
  const part = partOf(target);
  const thing = thingTargetAddress(target);
  return part === undefined ? thing : `${thing}/${partsSegment}/${part}`;
}

export function thingAddressOf(target: ListedTarget): string {
  return thingTargetAddress(target);
}

export function isPart(target: ListedTarget): boolean {
  return partOf(target) !== undefined;
}
