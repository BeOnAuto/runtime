import { definitionNamePattern, functionTypeOrder } from '@on.auto/definitions';
import { PlaybookIdSchema } from '@on.auto/operations';
import { Schema } from 'effect';

import type { ActivityPosition } from './activity-position.ts';

export type ItemForm = 'request' | 'broken' | 'result' | 'version' | 'playbook' | 'comment';

export interface ActivityItem {
  readonly form: ItemForm;
  readonly playbook: string;
  readonly key: string;
}

export const playbooksSegment = 'playbooks';

export const orgSegment = 'org';

export const ofTheOrg = '';

export const runsSegment = 'runs';

export const definitionsSegment = 'definitions';

const commentsSegment = 'comments';

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const definitionTypes: ReadonlySet<string> = new Set(['workflow', ...functionTypeOrder]);

export const countPattern = /^[1-9][0-9]{0,8}$/u;

const versionPattern = /^[1-9][0-9]{0,9}$/u;

const mostVersion = 2_147_483_646;

export const isPlaybookId = Schema.is(PlaybookIdSchema);

const millisecondsPattern = /^(?:0|[1-9][0-9]{0,15})$/u;

export function requestKeyOf(runId: string): string {
  return runId;
}

export function brokenKeyOf(type: string, name: string): string {
  return `${type}/${name}`;
}

export function resultKeyOf(runId: string): string {
  return `${runsSegment}/${runId}`;
}

export function versionKeyOf(type: string, name: string, version: number): string {
  return `${definitionsSegment}/${type}/${name}/${version}`;
}

export function commentKeyOf(id: string): string {
  return `${commentsSegment}/${id}`;
}

export function playbookChangeKeyOf(at: number): string {
  return `${playbooksSegment}/${at}`;
}

export function addressOf({ form, playbook, key }: ActivityItem): string {
  if (form === 'playbook') {
    return `${playbooksSegment}/${playbook}/${key.slice(playbooksSegment.length + 1)}`;
  }
  return playbook === ofTheOrg ? `${orgSegment}/${key}` : `${playbook}/${key}`;
}

export function isVersion(version: string): boolean {
  return versionPattern.test(version) && Number(version) <= mostVersion;
}

export function isDefinition(type: string, name: string): boolean {
  return definitionTypes.has(type) && definitionNamePattern.test(name);
}

function playbookChangeOf([first, playbook = '', at = '', ...rest]: readonly string[]): ActivityItem | undefined {
  return rest.length === 0 && first === playbooksSegment && isPlaybookId(playbook) && millisecondsPattern.test(at)
    ? { form: 'playbook', playbook, key: playbookChangeKeyOf(Number(at)) }
    : undefined;
}

type FormTest = (segments: readonly string[]) => boolean;

const formTests: readonly (readonly [ItemForm, FormTest])[] = [
  ['request', ([runId = '', ...rest]) => rest.length === 0 && uuidPattern.test(runId)],
  ['result', ([runs, runId = '', ...rest]) => rest.length === 0 && runs === runsSegment && uuidPattern.test(runId)],
  ['broken', ([type = '', name = '', ...rest]) => rest.length === 0 && isDefinition(type, name)],
  [
    'version',
    ([definitions, type = '', name = '', version = '', ...rest]) =>
      rest.length === 0 && definitions === definitionsSegment && isDefinition(type, name) && isVersion(version),
  ],
  [
    'comment',
    ([comments, id = '', ...rest]) => rest.length === 0 && comments === commentsSegment && uuidPattern.test(id),
  ],
];

function playbookItemOf([playbook = '', ...rest]: readonly string[]): ActivityItem | undefined {
  const form = isPlaybookId(playbook) ? formTests.find(([, holds]) => holds(rest))?.[0] : undefined;
  return form === undefined ? undefined : { form, playbook, key: rest.join('/') };
}

export function itemOfAddress(address: string): ActivityItem | undefined {
  const segments = address.split('/');
  return playbookChangeOf(segments) ?? playbookItemOf(segments);
}

export function positionOfItem(item: ActivityItem, at: number): ActivityPosition {
  return { at, playbook: item.playbook, key: item.key };
}
