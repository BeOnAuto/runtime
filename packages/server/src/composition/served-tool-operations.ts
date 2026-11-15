import { foundPlaybook, searchLeadWhereGoalsAreKeptOf } from '@on.auto/playbooks';
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
  readonly goals?: boolean | undefined;
  readonly messages?: boolean | undefined;
}

export function toolOperationsOf(tools: ToolAccess, { offering, goals, messages }: ProvidersOffered) {
  const searchLead = goals === true ? searchLeadWhereGoalsAreKeptOf(messages === true) : '';
  const executing = defineExecuteConnection(tools);
  return {
    inOrg: [defineSearchInOrg(tools, foundPlaybook, offering, searchLead), defineListConnectionTools(tools)],
    inPlaybook: [
      defineSearch(tools),
      defineIntrospect(tools),
      defineValidate(tools),
      defineDryRun(tools, executing.registration),
      defineQueryConnection(tools),
      executing,
    ],
  };
}

export type ServedToolOperations = ReturnType<typeof toolOperationsOf>;
