import {
  changeKindOf,
  strictRecordedDecoder,
  type ChangedFact,
  type ChangeNaming,
  type ResourceChange,
} from '@on.auto/operations';

import { PlaybookEventSchema, type RecordedPlaybookEvent } from './playbook-events.ts';
import { playbooksStream } from './playbooks-stream.ts';

const playbookChanged = changeKindOf(
  'playbook',
  'A playbook created, updated or retired',
  { playbook: 'The id of the playbook' },
  { playbook: 'playbook' },
);

const decodePlaybookFact = strictRecordedDecoder(PlaybookEventSchema);

function playbookChangedBy(fact: ChangedFact): readonly ResourceChange[] {
  return [playbookChanged.of({ playbook: decodePlaybookFact(fact).data.playbook })];
}

const named: Readonly<Record<RecordedPlaybookEvent['type'], (fact: ChangedFact) => readonly ResourceChange[]>> = {
  playbook_created: playbookChangedBy,
  playbook_updated: playbookChangedBy,
  playbook_retired: playbookChangedBy,
};

export const playbookChanges: ChangeNaming<ChangedFact> = {
  streamKind: playbooksStream,
  changes: { kinds: [playbookChanged], named },
};
