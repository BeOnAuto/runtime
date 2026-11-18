import { OrgReader, type ProjectedCondition } from '@on.auto/operations';
import { Effect } from 'effect';

import { anyMember, requestsName } from '../projections/request-rows.ts';
import type { Viewer } from './activity-viewer.ts';

const localDeveloper = 'local';

const open: ProjectedCondition = { column: 'open', equals: true };

export interface RequestSetAside {
  readonly goal: string;
  readonly id: string;
  readonly at: string;
  readonly by: string;
}

export interface OpenRequestSetAside {
  readonly waitsOn: string;
  readonly setAside: RequestSetAside;
}

export type RequestsSetAside = ReadonlyMap<string, ReadonlyMap<string, OpenRequestSetAside>>;

export const noneSetAside: RequestsSetAside = new Map();

const noneOfAPlaybook: ReadonlyMap<string, OpenRequestSetAside> = new Map();

export function setAsideIn(setAside: RequestsSetAside, playbook: string): ReadonlyMap<string, OpenRequestSetAside> {
  return setAside.get(playbook) ?? noneOfAPlaybook;
}

function isWaitingOn({ caller }: Viewer, { waitsOn }: OpenRequestSetAside): boolean {
  return caller === localDeveloper || waitsOn === anyMember || waitsOn === caller;
}

function waitingIn(viewer: Viewer, playbook: string) {
  return Effect.gen(function* () {
    const reader = yield* OrgReader;
    if (viewer.caller === localDeveloper) {
      return yield* reader.countPlaybookRows(playbook, requestsName, [open]);
    }
    const waitingOn = (party: string) =>
      reader.countPlaybookRows(playbook, requestsName, [open, { column: 'waits_on', equals: party }]);
    const anyone = yield* waitingOn(anyMember);
    const asked = yield* waitingOn(viewer.caller);
    return anyone + asked;
  });
}

export function needsYouIn(viewer: Viewer, playbook: string, setAside: RequestsSetAside) {
  const leftOut = [...setAsideIn(setAside, playbook).values()].filter((request) => isWaitingOn(viewer, request));
  return Effect.map(waitingIn(viewer, playbook), (waiting) => waiting - leftOut.length);
}
