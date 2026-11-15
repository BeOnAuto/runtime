import { Predicate } from 'effect';

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

function viaOf(principal: PrincipalReference, request: OrgRequest | PlaybookRequest): ArrivedVia {
  if (isMadeByARun(request)) {
    return 'run';
  }
  if (principal.type !== 'person') {
    return viaOfPrincipal[principal.type];
  }
  return request.caller.client === undefined ? 'studio' : 'agent';
}

function contextOf(
  registration: Runnable,
  request: OrgRequest | PlaybookRequest,
  principal: PrincipalReference,
): AccessContext {
  const { org, permissions, playbooks } = request.caller;
  return {
    via: viaOf(principal, request),
    granted: { org, permissions, playbooks },
    operation: {
      kind: registration.kind,
      targetsPlaybook: registration.targetsPlaybook,
      readsOnly: registration.readsOnly,
      reachesOutside: registration.reachesOutside,
      mayChangeOutside: registration.mayChangeOutside,
      irreversible: registration.irreversible,
      permissionsManagement: registration.permissionsManagement,
    },
  };
}

function requestOn(
  registration: Runnable,
  request: OrgRequest | PlaybookRequest,
  resource: ResourceReference,
): AccessRequest | undefined {
  const principal = principalOf(request.caller);
  if (principal === undefined) {
    return undefined;
  }
  return {
    principal,
    action: { scope: registration.scope, name: registration.name },
    resource,
    context: contextOf(registration, request, principal),
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

export function accessRequestOfOrgCall(registration: Runnable<'org'>, request: OrgRequest): AccessRequest | undefined {
  return requestOn(registration, request, resourceOfOrgCall(registration, request));
}

export function accessRequestOfPlaybookCall(
  registration: Runnable<'playbook'>,
  request: PlaybookRequest,
): AccessRequest | undefined {
  return requestOn(registration, request, { type: 'playbook', id: request.playbook, org: request.org });
}

export interface AskedOfACaller {
  readonly caller: CallerIdentity;
  readonly org: string;
  readonly playbook?: string;
}

const whicheverPlaybookItNames: PlaybookAccess = '*';

function takesAPlaybook(registration: Runnable): boolean {
  return registration.scope === 'playbook' || registration.targetsPlaybook;
}

export function accessRequestOfAsking(
  registration: Runnable,
  { caller, org, playbook }: AskedOfACaller,
): AccessRequest | undefined {
  if (playbook === undefined || !takesAPlaybook(registration)) {
    const listing = { ...caller, playbooks: whicheverPlaybookItNames };
    return requestOn(registration, { caller: listing, org, input: {}, encoding: 'json' }, { type: 'org', id: org });
  }
  return requestOn(
    registration,
    { caller, org, input: { playbook }, encoding: 'json' },
    { type: 'playbook', id: playbook, org },
  );
}
