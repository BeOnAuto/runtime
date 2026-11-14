import type { RouteRegistration } from '@on.auto/operations';

import { listPlaybooksDescribed, listPlaybooksSentences } from '../operations/list-playbooks.ts';
import { restorePlaybook } from '../operations/restore-playbook.ts';
import { retirePlaybook } from '../operations/retire-playbook.ts';
import { askedBeforeMakingWordsOf } from '../plain-language/goals-words.ts';
import { defineGetPlaybookWithGoals } from './get-playbook-with-goals.ts';
import { defineCreatePlaybookKeepingGoals, defineUpdatePlaybookKeepingGoals } from './playbook-goals-operations.ts';
import type { CheckedGoals, PlaybookGoals } from './playbook-goals.ts';

interface OrgOperation {
  readonly registration: RouteRegistration<'org'>;
}

export function playbookOperationsKeepingGoals<Checked extends CheckedGoals>(
  goals: PlaybookGoals<Checked>,
): readonly OrgOperation[] {
  return [
    defineCreatePlaybookKeepingGoals(goals),
    listPlaybooksDescribed([askedBeforeMakingWordsOf(goals.messages), ...listPlaybooksSentences].join(' ')),
    defineGetPlaybookWithGoals(goals),
    defineUpdatePlaybookKeepingGoals(goals),
    retirePlaybook,
    restorePlaybook,
  ];
}
