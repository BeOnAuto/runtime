import type { AppRuntime } from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import type { SubjectPages } from '@on.auto/definitions/page';
import type { DispatcherServices, RouteRegistration } from '@on.auto/operations';
import { defineImportPlaybook } from '@on.auto/playbooks';
import type { OfferedModels } from '@on.auto/reasoning';
import type { ToolAccess } from '@on.auto/tool-servers';

import { playbookGoalsServedBy } from '../goals/reads/served-playbook-goals.ts';
import { modelOfferedBy, serversPresentIn } from './import-ports.ts';
import { playbookImportsServedBy } from './served-playbook-imports.ts';

interface ImportsServed {
  readonly goals: boolean;
  readonly messages: boolean;
  readonly pages: SubjectPages;
  readonly listServers: ToolAccess['listServers'];
  readonly offered: OfferedModels;
}

interface OrgOperation {
  readonly registration: RouteRegistration<'org'>;
}

type ImportOperationsOver = (capabilities: readonly Capability[]) => readonly OrgOperation[];

export function importOperationsOf(
  runtime: AppRuntime<DispatcherServices>,
  { goals, messages, pages, listServers, offered }: ImportsServed,
): ImportOperationsOver {
  const servers = serversPresentIn(listServers);
  const offers = modelOfferedBy(offered);
  return (capabilities) =>
    goals
      ? [
          defineImportPlaybook(
            playbookGoalsServedBy(runtime, pages, messages, capabilities),
            playbookImportsServedBy(runtime, { capabilities, pages, servers, offers }),
          ),
        ]
      : [];
}
