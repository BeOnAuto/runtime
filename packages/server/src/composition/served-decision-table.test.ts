import type { DeclaredAction } from '@on.auto/access-control';
import { operationsIn, type DocumentedOperation } from '@on.auto/api/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decisionTableOf, type DecisionRow } from '../testing/access/decision-table.ts';
import { declarationLineOf, declaredIn, permissionsOf } from '../testing/openapi/declared-operations.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer;
let documented: readonly DocumentedOperation[];
let operations: readonly DeclaredAction[];
let table: readonly DecisionRow[];

beforeAll(async () => {
  server = await servingReasoning([]);
  documented = operationsIn(await (await fetch(`${server.origin}/v1/openapi.json`)).json());
  operations = declaredIn(documented);
  table = await decisionTableOf(operations);
});

afterAll(async () => {
  await server.stop();
});

const declared = [
  'org/activate_allocation: org:write',
  'org/activate_license: org:write',
  'org/add_connection: org:write',
  'org/approve: org:write',
  'org/assign_role: org:write',
  'org/create_playbook: org:write (names a playbook)',
  'org/finish: org:write',
  'org/get_connection: org:read',
  'org/get_license: org:read,playbook:read',
  'org/get_playbook: org:read (names a playbook)',
  'org/get_voice: playbook:read',
  'org/give_client: org:write',
  'org/give_credential: org:write',
  'org/list_activity: org:read,playbook:read (names a playbook)',
  'org/list_comments: org:read,playbook:read',
  'org/list_connection_tools: org:read',
  'org/list_connections: org:read',
  'org/list_generation_models: org:read',
  'org/list_models: org:read',
  'org/list_org_changes: org:read,playbook:read',
  'org/list_playbooks: org:read,playbook:read',
  'org/list_providers: org:read',
  'org/list_role_assignments: org:read',
  'org/make_comment: org:read,playbook:read',
  'org/mark_activity_seen: org:read,playbook:read',
  'org/read_link: org:write',
  'org/reconnect_connection: org:write',
  'org/remove_connection: org:write',
  'org/remove_connection_signing_secret: org:write',
  'org/reopen_comment: org:read,playbook:read',
  'org/report_allocation: org:write',
  'org/resolve_comment: org:read,playbook:read',
  'org/restore_playbook: org:write (names a playbook)',
  'org/retire_playbook: org:write (names a playbook)',
  'org/search: org:read,playbook:read (names a playbook)',
  'org/set_connection_playbooks: org:write',
  'org/set_connection_signing_secret: org:write',
  'org/start: org:write',
  'org/transcribe: playbook:read',
  'org/unassign_role: org:write',
  'org/update_playbook: org:write (names a playbook)',
  'playbook/answer_interaction: playbook:write',
  'playbook/cancel_run: playbook:write',
  'playbook/create_definition: playbook:write',
  'playbook/dry_run: playbook:read',
  'playbook/execute_connection: playbook:write',
  'playbook/get_asset: playbook:read',
  'playbook/get_definition: playbook:read',
  'playbook/get_event: playbook:read',
  'playbook/get_playbook_analytics: playbook:read',
  'playbook/get_run: playbook:read',
  'playbook/get_run_history: playbook:read',
  'playbook/introspect: playbook:read',
  'playbook/list_comments: playbook:read',
  'playbook/list_definitions: playbook:read',
  'playbook/list_interactions: playbook:read',
  'playbook/list_playbook_changes: playbook:read',
  'playbook/list_playbook_events: playbook:read',
  'playbook/list_runs: playbook:read',
  'playbook/make_comment: playbook:read',
  'playbook/pause_definition: playbook:write',
  'playbook/publish_event: playbook:write',
  'playbook/query_connection: playbook:write',
  'playbook/render_page: playbook:read',
  'playbook/render_playbook_page: playbook:read',
  'playbook/reopen_comment: playbook:read',
  'playbook/resolve_comment: playbook:read',
  'playbook/restore_definition: playbook:write',
  'playbook/resume_definition: playbook:write',
  'playbook/retire_definition: playbook:write',
  'playbook/run_definition: playbook:write',
  'playbook/search: playbook:read',
  'playbook/send_run_event: playbook:write',
  'playbook/start_definition_version: playbook:write',
  'playbook/update_definition: playbook:write',
  'playbook/validate: playbook:read',
];

const whatReadingPermits = [
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
  'playbook/list_interactions',
  'playbook/list_playbook_changes',
  'playbook/list_playbook_events',
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
  'org/create_playbook',
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
  'org/set_connection_playbooks',
  'org/set_connection_signing_secret',
  'org/start',
  'org/unassign_role',
  'org/update_playbook',
  'playbook/answer_interaction',
  'playbook/cancel_run',
  'playbook/create_definition',
  'playbook/execute_connection',
  'playbook/pause_definition',
  'playbook/publish_event',
  'playbook/query_connection',
  'playbook/restore_definition',
  'playbook/resume_definition',
  'playbook/retire_definition',
  'playbook/run_definition',
  'playbook/send_run_event',
  'playbook/start_definition_version',
  'playbook/update_definition',
];

const everything = [...whatReadingPermits, ...whatOnlyWritingPermits].toSorted();

const whatPlaybookAlphaMayDoAsItself = [
  ...everything.filter((operation) => operation.startsWith('playbook/')),
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
  { caller: 'Admin, through their connected agent', allowed: everything },
  { caller: 'Admin, asking @Auto in Slack', allowed: everything },
  { caller: 'Admin, in a run they started', allowed: everything },
  { caller: 'Editor, in Studio', allowed: everything },
  { caller: 'Editor, through their connected agent', allowed: everything },
  { caller: 'Editor, asking @Auto in Slack', allowed: everything },
  { caller: 'Editor, in a run they started', allowed: everything },
  { caller: 'Editor, through an agent they approved to read', allowed: whatReadingPermits },
  { caller: 'Viewer, in Studio', allowed: whatReadingPermits },
  { caller: 'Viewer, through their connected agent', allowed: whatReadingPermits },
  { caller: 'Viewer, asking @Auto in Slack', allowed: whatReadingPermits },
  { caller: 'Viewer, in a run they started', allowed: everything },
  { caller: 'A person with no role, in Studio', allowed: [] },
  { caller: 'An Editor of another org, in Studio', allowed: [] },
  { caller: 'An API key', allowed: everything },
  { caller: 'An API key that reads', allowed: whatReadingPermits },
  { caller: 'Playbook alpha, in a run a trigger or a schedule started', allowed: whatPlaybookAlphaMayDoAsItself },
];

describe('every operation the server serves, as its API document declares it', () => {
  it('is permitted by the permissions it declares, any one of them, and names a playbook where it says so, the start of a version the workflow host makes among them', () => {
    expect(operations.map((operation) => declarationLineOf(operation))).toEqual(declared);
  });

  it('is answered without a permission only for content at its signed address and for the guides, which no decision point is asked about', () => {
    expect(
      documented
        .filter((described) => permissionsOf(described).length === 0)
        .map(({ operation }) => operation.operationId),
    ).toEqual(['get_content', 'get_guide']);
  });
});

describe('every operation the server serves, decided for each role and each kind of caller', () => {
  it('is allowed as this table says, so an operation added or a declaration changed shows as a changed row', () => {
    expect(table.map(({ caller, allowed }) => ({ caller, allowed }))).toEqual(pinned);
  });

  it('is decided alike whatever else it declares about itself, which its API document does not say', () => {
    expect(table.flatMap(({ decidedOtherwise }) => decidedOtherwise)).toEqual([]);
  });
});
