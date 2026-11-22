import { operationsIn, type DocumentedOperation } from '@on.auto/api/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decisionTableOf, type DecisionRow } from '../testing/access/decision-table.ts';
import { servedDeclarations } from '../testing/access/served-declarations.ts';
import {
  declarationLineOf,
  declaredIn,
  permissionsOf,
  type ServedDeclaration,
} from '../testing/openapi/declared-operations.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;
let documented: readonly DocumentedOperation[];
let operations: readonly ServedDeclaration[];
let table: readonly DecisionRow[];

beforeAll(async () => {
  server = await servingReasoning([]);
  documented = operationsIn(await (await fetch(`${server.origin}/v1/openapi.json`)).json());
  operations = declaredIn(documented);
  table = await decisionTableOf(operations);
});

afterAll(() => server.stop());

const whatReadingPermits = [
  'org/get_caller',
  'org/get_connection',
  'org/get_license',
  'org/get_playbook',
  'org/get_voice',
  'org/list_activity',
  'org/list_comments',
  'org/list_connection_tools',
  'org/list_connections',
  'org/list_generation_models',
  'org/list_models',
  'org/list_org_changes',
  'org/list_playbooks',
  'org/list_providers',
  'org/list_role_assignments',
  'org/make_comment',
  'org/mark_activity_seen',
  'org/reopen_comment',
  'org/resolve_comment',
  'org/search',
  'org/transcribe',
  'playbook/dry_run',
  'playbook/get_asset',
  'playbook/get_definition',
  'playbook/get_event',
  'playbook/get_playbook_analytics',
  'playbook/get_run',
  'playbook/get_run_history',
  'playbook/introspect',
  'playbook/list_comments',
  'playbook/list_definitions',
  'playbook/list_generation_models',
  'playbook/list_interactions',
  'playbook/list_playbook_changes',
  'playbook/list_playbook_events',
  'playbook/list_queued_starts',
  'playbook/list_runs',
  'playbook/make_comment',
  'playbook/render_page',
  'playbook/render_playbook_page',
  'playbook/reopen_comment',
  'playbook/resolve_comment',
  'playbook/search',
  'playbook/validate',
];

const whatOnlyWritingPermits = [
  'org/activate_allocation',
  'org/activate_license',
  'org/add_connection',
  'org/approve',
  'org/assign_role',
  'org/choose_way',
  'org/create_playbook',
  'org/decline_connection_request',
  'org/finish',
  'org/give_client',
  'org/give_credential',
  'org/read_link',
  'org/reconnect_connection',
  'org/remove_connection',
  'org/remove_connection_signing_secret',
  'org/report_allocation',
  'org/restore_playbook',
  'org/retire_playbook',
  'org/set_connection_account_type',
  'org/set_connection_model',
  'org/set_connection_playbooks',
  'org/set_connection_signing_secret',
  'org/start',
  'org/unassign_role',
  'org/update_playbook',
  'playbook/answer_interaction',
  'playbook/cancel_run',
  'playbook/create_definition',
  'playbook/execute_connection',
  'playbook/make_next_attempt',
  'playbook/move_definitions',
  'playbook/pause_definition',
  'playbook/publish_event',
  'playbook/query_connection',
  'playbook/refuse_next_attempt',
  'playbook/restore_definition',
  'playbook/resume_definition',
  'playbook/retire_definition',
  'playbook/run_definition',
  'playbook/send_run_event',
  'playbook/start_definition_version',
  'playbook/update_definition',
];

const everything = [...whatReadingPermits, ...whatOnlyWritingPermits].toSorted();

const whatManagesPermissions = ['org/assign_role', 'org/unassign_role'];

const everythingButWhatManagesPermissions = everything.filter((name) => !whatManagesPermissions.includes(name));

const whatManagesConnections = ['org/set_connection_model'];

const whatOnlyAnAdminChanges = [...whatManagesPermissions, ...whatManagesConnections].toSorted();

const everythingButWhatOnlyAnAdminChanges = everything.filter((name) => !whatOnlyAnAdminChanges.includes(name));

const whatPlaybookAlphaMayDoAsItself = [
  ...everything.filter((operation) => operation.startsWith('playbook/')),
  'org/get_caller',
  'org/get_license',
  'org/get_voice',
  'org/list_comments',
  'org/list_org_changes',
  'org/list_playbooks',
  'org/make_comment',
  'org/mark_activity_seen',
  'org/reopen_comment',
  'org/resolve_comment',
  'org/transcribe',
].toSorted();

const pinned = [
  { caller: 'Admin, in Studio', allowed: everything },
  { caller: 'Admin, through their connected agent', allowed: everythingButWhatManagesPermissions },
  { caller: 'Admin, asking @Auto in Slack', allowed: everythingButWhatManagesPermissions },
  { caller: 'Admin, in a run they started', allowed: everythingButWhatManagesPermissions },
  { caller: 'Editor, in Studio', allowed: everythingButWhatOnlyAnAdminChanges },
  { caller: 'Editor, through their connected agent', allowed: everythingButWhatOnlyAnAdminChanges },
  { caller: 'Editor, asking @Auto in Slack', allowed: everythingButWhatOnlyAnAdminChanges },
  { caller: 'Editor, in a run they started', allowed: everythingButWhatOnlyAnAdminChanges },
  { caller: 'Editor, through an agent they approved to read', allowed: whatReadingPermits },
  { caller: 'Viewer, in Studio', allowed: whatReadingPermits },
  { caller: 'Viewer, through their connected agent', allowed: whatReadingPermits },
  { caller: 'Viewer, asking @Auto in Slack', allowed: whatReadingPermits },
  { caller: 'Viewer, in a run they started', allowed: everythingButWhatOnlyAnAdminChanges },
  { caller: 'A person with no role, in Studio', allowed: [] },
  { caller: 'An Editor of another org, in Studio', allowed: [] },
  { caller: 'An API key', allowed: everythingButWhatManagesPermissions },
  { caller: 'An API key that reads', allowed: whatReadingPermits },
  { caller: 'Playbook alpha, in a run a trigger or a schedule started', allowed: whatPlaybookAlphaMayDoAsItself },
  { caller: 'The local developer', allowed: everythingButWhatManagesPermissions },
];

describe('every operation the server serves, as its API document declares it', () => {
  it('is permitted by the permissions it declares, any one of them, and names a playbook where it says so, the start of a version the workflow host makes among them', () => {
    expect(operations.map((operation) => declarationLineOf(operation))).toEqual(servedDeclarations);
  });

  it('is answered without a permission only for content at its signed address and for the guides, which no decision point is asked about', () => {
    expect(
      documented
        .filter((described) => permissionsOf(described).length === 0)
        .map(({ operation }) => operation.operationId),
    ).toEqual(['get_content', 'get_guide']);
  });
});

const refusedForTheRoleOrTheTokenType = [
  { caller: 'Admin, in Studio', forTheRole: [], forTheTokenType: [] },
  { caller: 'Admin, through their connected agent', forTheRole: [], forTheTokenType: whatManagesPermissions },
  { caller: 'Admin, asking @Auto in Slack', forTheRole: [], forTheTokenType: whatManagesPermissions },
  { caller: 'Admin, in a run they started', forTheRole: [], forTheTokenType: [] },
  { caller: 'Editor, in Studio', forTheRole: whatOnlyAnAdminChanges, forTheTokenType: [] },
  { caller: 'Editor, through their connected agent', forTheRole: whatOnlyAnAdminChanges, forTheTokenType: [] },
  { caller: 'Editor, asking @Auto in Slack', forTheRole: whatOnlyAnAdminChanges, forTheTokenType: [] },
  { caller: 'Editor, in a run they started', forTheRole: [], forTheTokenType: [] },
  { caller: 'Editor, through an agent they approved to read', forTheRole: whatOnlyAnAdminChanges, forTheTokenType: [] },
  { caller: 'Viewer, in Studio', forTheRole: whatOnlyWritingPermits, forTheTokenType: [] },
  { caller: 'Viewer, through their connected agent', forTheRole: whatOnlyWritingPermits, forTheTokenType: [] },
  { caller: 'Viewer, asking @Auto in Slack', forTheRole: whatOnlyWritingPermits, forTheTokenType: [] },
  { caller: 'Viewer, in a run they started', forTheRole: [], forTheTokenType: [] },
  { caller: 'A person with no role, in Studio', forTheRole: everything, forTheTokenType: [] },
  { caller: 'An Editor of another org, in Studio', forTheRole: everything, forTheTokenType: [] },
  { caller: 'An API key', forTheRole: [], forTheTokenType: whatManagesPermissions },
  { caller: 'An API key that reads', forTheRole: [], forTheTokenType: whatManagesPermissions },
  { caller: 'Playbook alpha, in a run a trigger or a schedule started', forTheRole: [], forTheTokenType: [] },
  { caller: 'The local developer', forTheRole: [], forTheTokenType: whatManagesPermissions },
];

describe('every operation the server serves, decided for each role and each kind of caller by the decision point the server loads at start', () => {
  it('is allowed as this table says, so an operation added or a declaration changed shows as a changed row', () => {
    expect(table.map(({ caller, allowed }) => ({ caller, allowed }))).toEqual(pinned);
  });

  it('is decided alike whatever else it declares about itself, which its API document does not say, but for whether it manages permissions, which its registration says', () => {
    expect(table.flatMap(({ decidedOtherwise }) => decidedOtherwise)).toEqual([]);
  });
});

describe('every operation the server serves, as the server refuses it, for each role and each kind of caller', () => {
  it('is allowed exactly where the decision point allows it, and refused, where a credential granted everything would still be refused, for the type of credential where the same person in Studio would be allowed or the caller holds no role, and for the role otherwise', () => {
    expect(
      table.map(({ caller, refusedForTheRole, refusedForTheTokenType }) => ({
        caller,
        forTheRole: refusedForTheRole,
        forTheTokenType: refusedForTheTokenType,
      })),
    ).toEqual(refusedForTheRoleOrTheTokenType);
    expect(table.flatMap(({ enforcedOtherwise }) => enforcedOtherwise)).toEqual([]);
  });
});

interface DecidedRow {
  readonly caller: string;
  readonly allowed: readonly string[];
}

function approvingOfThoseAdding(rows: readonly DecidedRow[]): readonly (readonly [string, boolean])[] {
  return rows
    .filter((row) => row.allowed.includes('org/add_connection'))
    .map((row) => [row.caller, row.allowed.includes('org/approve')] as const);
}

describe('adding a connection, as the decision point the server loads decides who may also approve it', () => {
  it('lets every caller it lets add a connection approve one too, so each is answered a link as before and none a request', () => {
    expect(approvingOfThoseAdding(table)).toEqual(approvingOfThoseAdding(pinned).map(([caller]) => [caller, true]));
  });
});
