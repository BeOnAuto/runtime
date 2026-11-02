import { bytesOfReference, holdsNoForbiddenCharacter, mostReferenceBytes } from '@on.auto/operations';

import {
  countPattern,
  definitionsSegment,
  isDefinition,
  isPlaybookId,
  playbooksSegment,
  runsSegment,
  uuidPattern,
} from './activity-addresses.ts';

export const mostAddressCharacters = 512;

const stepsSegment = 'steps';

const eventsSegment = 'events';

const resultSegment = 'result';

const workflowType = 'workflow';

const eventIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:_[1-9][0-9]{0,8})?$/u;

const whiteSpace = /\s/u;

interface DefinitionAtVersion {
  readonly type: string;
  readonly name: string;
  readonly version: number;
}

export type CommentTarget =
  | { readonly kind: 'playbook'; readonly playbook: string }
  | ({ readonly kind: 'definition'; readonly playbook: string } & DefinitionAtVersion)
  | ({ readonly kind: 'step'; readonly playbook: string; readonly step: string } & DefinitionAtVersion)
  | { readonly kind: 'run'; readonly playbook: string; readonly run: string }
  | { readonly kind: 'event'; readonly playbook: string; readonly run: string; readonly event: string }
  | { readonly kind: 'block'; readonly playbook: string; readonly run: string; readonly block: number }
  | { readonly kind: 'request'; readonly playbook: string; readonly run: string };

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

function isStep(step: readonly string[]): boolean {
  return step.length > 0 && bytesOfReference(`/${step.join('/')}`) <= mostReferenceBytes;
}

function atVersionPlace(playbook: string, type: string, name: string, [version = '', ...rest]: readonly string[]) {
  const atVersion = { playbook, type, name, version: Number(version) };
  if (rest.length === 0) {
    return { kind: 'definition', ...atVersion } satisfies ListedTarget;
  }
  const [steps, ...step] = rest;
  return type === workflowType && steps === stepsSegment && isStep(step)
    ? ({ kind: 'step', ...atVersion, step: step.join('/') } satisfies ListedTarget)
    : undefined;
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
  return countPattern.test(version) ? atVersionPlace(playbook, type, name, rest) : undefined;
}

const definitionPlace: Place = (playbook, [type = '', name = '', ...rest]) =>
  isDefinition(type, name) ? versionsPlace(playbook, type, name, rest) : undefined;

function partOfRun(playbook: string, run: string, [part, id = '']: readonly string[]): ListedTarget | undefined {
  if (part === undefined) {
    return { kind: 'run', playbook, run };
  }
  if (part === eventsSegment && eventIdPattern.test(id)) {
    return { kind: 'event', playbook, run, event: id };
  }
  return part === resultSegment && countPattern.test(id)
    ? { kind: 'block', playbook, run, block: Number(id) }
    : undefined;
}

const runPlace: Place = (playbook, [run = '', ...rest]) =>
  uuidPattern.test(run) && rest.length <= 2 ? partOfRun(playbook, run, rest) : undefined;

const places: Readonly<Record<string, Place>> = { [definitionsSegment]: definitionPlace, [runsSegment]: runPlace };

function placeIn(playbook: string, [segment = '', ...segments]: readonly string[]): ListedTarget | undefined {
  const place = Object.hasOwn(places, segment) ? places[segment] : undefined;
  return place?.(playbook, segments);
}

function listedTargetIn([first = '', ...rest]: readonly string[]): ListedTarget | undefined {
  const [second = ''] = rest;
  if (rest.length === 1 && uuidPattern.test(second)) {
    return isPlaybookId(first) ? { kind: 'request', playbook: first, run: second } : undefined;
  }
  if (first === playbooksSegment) {
    return rest.length === 1 && isPlaybookId(second) ? { kind: 'playbook', playbook: second } : undefined;
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

export function addressOfTarget(target: ListedTarget): string {
  if (target.kind === 'playbook') {
    return `${playbooksSegment}/${target.playbook}`;
  }
  if (target.kind === 'request') {
    return `${target.playbook}/${target.run}`;
  }
  if (target.kind === 'every_version') {
    return `${target.playbook}/${definitionsSegment}/${target.type}/${target.name}`;
  }
  return target.kind === 'definition' || target.kind === 'step'
    ? definitionTargetAddress(target)
    : runTargetAddress(target);
}
