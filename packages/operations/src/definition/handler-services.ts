import type { CallLineage } from '../caller/call-lineage.ts';
import type { Caller } from '../caller/caller.ts';
import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import type { OrgContext } from '../caller/org-context.ts';
import type { PlaybookContext } from '../caller/playbook-context.ts';
import type { PlaybookLifecycle } from '../caller/playbook-lifecycle.ts';
import type { OrgReader } from '../ledger/org-reader.ts';
import type { OrgWriter } from '../ledger/org-writer.ts';
import type { PlaybookReader } from '../ledger/playbook-reader.ts';
import type { PlaybookWriter } from '../ledger/playbook-writer.ts';

interface ServicesByScopeAndKind {
  readonly org: {
    readonly query: Caller | OrgContext | OrgReader;
    readonly command: Caller | OrgContext | OrgReader | OrgWriter;
  };
  readonly playbook: {
    readonly query: Caller | PlaybookContext | PlaybookLifecycle | PlaybookReader;
    readonly command: Caller | PlaybookContext | PlaybookLifecycle | PlaybookReader | PlaybookWriter | CallLineage;
  };
}

export type HandlerServices<S extends OperationScope, K extends OperationKind> = ServicesByScopeAndKind[S][K];
