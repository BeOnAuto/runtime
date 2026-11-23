import {
  playbookChangedAcrossTheOrg as playbookChanged,
  strictRecordedDecoder,
  type ChangedFact,
  type ChangeNaming,
  type ResourceChange,
} from '@on.auto/operations';

import { PlaybookEventSchema, type RecordedPlaybookEvent } from './playbook-events.ts';
import { playbooksStream } from './playbooks-stream.ts';

const decodePlaybookFact = strictRecordedDecoder(PlaybookEventSchema);

function playbookChangedBy(fact: ChangedFact): readonly ResourceChange[] {
  return [playbookChanged.of({ playbook: decodePlaybookFact(fact).data.playbook })];
}

const named: Readonly<Record<RecordedPlaybookEvent['type'], (fact: ChangedFact) => readonly ResourceChange[]>> = {
  playbook_created: playbookChangedBy,
  playbook_updated: playbookChangedBy,
  playbook_retired: playbookChangedBy,
  playbook_restored: playbookChangedBy,
};

export const playbookChanges: ChangeNaming<ChangedFact> = {
  streamKind: playbooksStream,
  changes: { kinds: [playbookChanged], named },
};
