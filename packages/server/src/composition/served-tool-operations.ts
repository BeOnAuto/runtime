import { foundPlaybook } from '@on.auto/playbooks';
import {
  defineDryRun,
  defineExecuteConnection,
  defineIntrospect,
  defineQueryConnection,
  defineListConnectionTools,
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
    inOrg: [defineSearchInOrg(tools, foundPlaybook, offering), defineListConnectionTools(tools)],
    inPlaybook: [
      defineSearch(tools),
      defineIntrospect(tools),
      defineValidate(tools),
      defineDryRun(tools),
      defineQueryConnection(tools),
      defineExecuteConnection(tools),
    ],
  };
}

export type ServedToolOperations = ReturnType<typeof toolOperationsOf>;
