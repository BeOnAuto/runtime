import { foundPlaybook } from '@on.auto/playbooks';
import {
  defineDryRun,
  defineExecute,
  defineIntrospect,
  defineSearch,
  defineSearchInOrg,
  defineValidate,
  type ProviderOffering,
  type ToolAccess,
} from '@on.auto/tool-servers';

export interface ProvidersOffered {
  readonly offering: ProviderOffering;
}

export function toolOperationsOf(tools: ToolAccess, { offering }: ProvidersOffered) {
  return {
    inOrg: [defineSearchInOrg(tools, foundPlaybook, offering)],
    inPlaybook: [
      defineSearch(tools),
      defineIntrospect(tools),
      defineValidate(tools),
      defineDryRun(tools),
      defineExecute(tools),
    ],
  };
}

export type ServedToolOperations = ReturnType<typeof toolOperationsOf>;
