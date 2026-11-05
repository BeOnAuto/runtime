import type { RouteRegistration } from '@on.auto/operations';

import { createPlaybook } from './create-playbook.ts';
import { defineGetPlaybook } from './get-playbook.ts';
import { listPlaybooks } from './list-playbooks.ts';
import type { PlaybookPages } from './playbook-pages.ts';
import { restorePlaybook } from './restore-playbook.ts';
import { retirePlaybook } from './retire-playbook.ts';
import { defineUpdatePlaybook } from './update-playbook.ts';

interface OrgOperation {
  readonly registration: RouteRegistration<'org'>;
}

export function playbookOperationsOf(pages: PlaybookPages): readonly OrgOperation[] {
  return [
    createPlaybook,
    listPlaybooks,
    defineGetPlaybook(pages),
    defineUpdatePlaybook(pages),
    retirePlaybook,
    restorePlaybook,
  ];
}
