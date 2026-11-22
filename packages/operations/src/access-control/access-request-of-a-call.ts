import { Context, Predicate } from 'effect';

import { playbookFieldOf } from '../authorization/authorization.ts';
import { localDeveloperId, playbookCallerPrefix, signedInPersonPrefix, type CallerIdentity } from '../caller/caller.ts';
import type { PlaybookAccess } from '../caller/playbook-access.ts';
import type { Runnable } from '../definition/registration.ts';
import type { OrgRequest, PlaybookRequest } from '../dispatch/request.ts';
import type {
  AccessContext,
  AccessRequest,
  ArrivedVia,
  PrincipalReference,
  ResourceReference,
} from './policy-decision-point.ts';

export type OperationDeclaration = Pick<
  Runnable,
  | 'scope'
  | 'name'
  | 'kind'
  | 'permissions'
  | 'targetsPlaybook'
  | 'readsOnly'
  | 'reachesOutside'
  | 'mayChangeOutside'
  | 'irreversible'
  | 'permissionsManagement'
  | 'enrolment'
  | 'connectionsManagement'
>;

export const InAConversation = Context.Reference<boolean>('@on.auto/operations/InAConversation', {
  defaultValue: () => false,
});

const keyIdsTakeNo = ':';

function principalOf({ id }: Pick<CallerIdentity, 'id'>): PrincipalReference | undefined {
  if (id === localDeveloperId) {
    return { type: 'local_developer', id };
  }
  if (id.startsWith(signedInPersonPrefix)) {
    return { type: 'person', id: id.slice(signedInPersonPrefix.length) };
  }
  if (id.startsWith(playbookCallerPrefix)) {
    return { type: 'playbook', id: id.slice(playbookCallerPrefix.length) };
  }
  return id.includes(keyIdsTakeNo) ? undefined : { type: 'key', id };
}

function namesItsRun({ lineage }: PlaybookRequest): boolean {
  return lineage !== undefined && lineage.correlationId !== null;
}

function isMadeByARun(request: OrgRequest | PlaybookRequest): boolean {
  return (
    'playbook' in request && (namesItsRun(request) || request.calledBy !== undefined || request.trigger !== undefined)
  );
}

const viaOfPrincipal: Readonly<Record<Exclude<PrincipalReference['type'], 'person'>, ArrivedVia>> = {
  key: 'key',
  playbook: 'run',
  local_developer: 'local',
};

function viaOf(
  principal: PrincipalReference,
  request: OrgRequest | PlaybookRequest,
  inAConversation: boolean,
): ArrivedVia {
  if (isMadeByARun(request)) {
    return 'run';
  }
  if (principal.type !== 'person') {
    return viaOfPrincipal[principal.type];
  }
  if (inAConversation) {
    return 'conversation';
  }
  return request.caller.client === undefined ? 'studio' : 'agent';
}

function contextOf(
  declaration: OperationDeclaration,
  request: OrgRequest | PlaybookRequest,
  principal: PrincipalReference,
  inAConversation: boolean,
): AccessContext {
  const { org, permissions, playbooks } = request.caller;
  return {
    via: viaOf(principal, request, inAConversation),
    granted: { org, permissions, playbooks },
    operation: {
      kind: declaration.kind,
      targetsPlaybook: declaration.targetsPlaybook,
      readsOnly: declaration.readsOnly,
      reachesOutside: declaration.reachesOutside,
      mayChangeOutside: declaration.mayChangeOutside,
      irreversible: declaration.irreversible,
      permissionsManagement: declaration.permissionsManagement,
      enrolment: declaration.enrolment === true,
      connectionsManagement: declaration.connectionsManagement === true,
    },
  };
}

function requestOn(
  declaration: OperationDeclaration,
  request: OrgRequest | PlaybookRequest,
  resource: ResourceReference,
  inAConversation: boolean,
): AccessRequest | undefined {
  const principal = principalOf(request.caller);
  if (principal === undefined) {
    return undefined;
  }
  return {
    principal,
    action: { scope: declaration.scope, name: declaration.name },
    resource,
    context: contextOf(declaration, request, principal, inAConversation),
  };
}

export function playbookNamedBy(registration: Runnable<'org'>, { input }: OrgRequest): string | undefined {
  const playbook = registration.targetsPlaybook ? playbookFieldOf(input) : undefined;
  return Predicate.isString(playbook) ? playbook : undefined;
}

function resourceOfOrgCall(registration: Runnable<'org'>, request: OrgRequest): ResourceReference {
  const playbook = playbookNamedBy(registration, request);
  return playbook === undefined
    ? { type: 'org', id: request.org }
    : { type: 'playbook', id: playbook, org: request.org };
}

export function accessRequestOfOrgCall(
  registration: Runnable<'org'>,
  request: OrgRequest,
  inAConversation: boolean,
): AccessRequest | undefined {
  return requestOn(registration, request, resourceOfOrgCall(registration, request), inAConversation);
}

export function accessRequestOfPlaybookCall(
  registration: Runnable<'playbook'>,
  request: PlaybookRequest,
  inAConversation: boolean,
): AccessRequest | undefined {
  return requestOn(
    registration,
    request,
    { type: 'playbook', id: request.playbook, org: request.org },
    inAConversation,
  );
}

export interface AskedOfACaller {
  readonly caller: CallerIdentity;
  readonly org: string;
  readonly playbook?: string;
}

const whicheverPlaybookItNames: PlaybookAccess = '*';

function takesAPlaybook(declaration: OperationDeclaration): boolean {
  return declaration.scope === 'playbook' || declaration.targetsPlaybook;
}

export function accessRequestOfAsking(
  declaration: OperationDeclaration,
  { caller, org, playbook }: AskedOfACaller,
  inAConversation: boolean,
): AccessRequest | undefined {
  if (playbook === undefined || !takesAPlaybook(declaration)) {
    const listing = { ...caller, playbooks: whicheverPlaybookItNames };
    return requestOn(
      declaration,
      { caller: listing, org, input: {}, encoding: 'json' },
      { type: 'org', id: org },
      inAConversation,
    );
  }
  return requestOn(
    declaration,
    { caller, org, input: { playbook }, encoding: 'json' },
    { type: 'playbook', id: playbook, org },
    inAConversation,
  );
}
