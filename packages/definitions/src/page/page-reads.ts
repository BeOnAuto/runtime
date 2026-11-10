import type { PlaybookAddress } from '@on.auto/operations';

import type { StoredDefinition } from '../registry/definition.ts';
import type { PayloadAsRead } from '../runs/run-payloads.ts';
import type { RunDetailAsRecorded } from '../runs/run.ts';
import type { RunShown, SubjectShown } from './page-rendering.ts';

export function subjectShownOf(type: string, { name, description, version }: StoredDefinition): SubjectShown {
  return { type, name, description: description ?? null, version };
}

export function playbookShownOf({ playbook }: PlaybookAddress): SubjectShown {
  return { type: 'playbook', name: playbook, description: null, version: null };
}

export function runShownOf(
  { status, rejection, started_at, finished_at, definition_version }: RunDetailAsRecorded,
  read?: PayloadAsRead,
): RunShown {
  if (rejection !== undefined) {
    const { reason, kind, detail } = rejection;
    return { status: 'rejected', rejection: { reason, detail, ...(kind === undefined ? {} : { kind }) } };
  }
  if (status === 'failed' || status === 'rejected') {
    return { status: 'failed' };
  }
  const times = { started: started_at, ended: finished_at ?? null, version: definition_version };
  if (read !== undefined && 'unread' in read) {
    return { status: 'succeeded', unread: { because: read.unread, bytes: read.kept.bytes }, ...times };
  }
  return { status, output: read?.read ?? null, ...times };
}
