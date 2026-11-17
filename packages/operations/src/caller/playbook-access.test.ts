import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  allPermissions,
  type CallerIdentity,
  canAccessPlaybook,
  type OperationKind,
  type OperationScope,
  OrgIdSchema,
  type Permission,
  permissionFor,
  PermissionSchema,
  PlaybookAccessSchema,
  PlaybookIdSchema,
} from '../index.ts';
import { acmeAdmin, acmeAlphaReader } from '../testing/callers.ts';
import { harness, toOrg, toPlaybook } from '../testing/harness.ts';
import { getNote } from '../testing/notes.ts';
import { getPlaybookLabel, labelPlaybook, listPlaybookLabels, relabelPlaybook } from '../testing/playbook-labels.ts';

const derived: ReadonlyArray<readonly [OperationKind, OperationScope, Permission]> = [
  ['query', 'org', 'org:read'],
  ['command', 'org', 'org:write'],
  ['query', 'playbook', 'playbook:read'],
  ['command', 'playbook', 'playbook:write'],
];

describe('permissions', () => {
  it('are four, one per scope and access', () => {
    expect(allPermissions).toEqual(['org:read', 'org:write', 'playbook:read', 'playbook:write']);
  });

  it.each(derived)('make a %s at %s scope need %s', (kind, scope, permission) => {
    expect(permissionFor(kind, scope)).toBe(permission);
  });

  it('decode only the four names', () => {
    const isPermission = Schema.is(PermissionSchema);

    expect(allPermissions.every((permission) => isPermission(permission))).toBe(true);
    expect(isPermission('org:admin')).toBe(false);
  });
});

const isOrgId = Schema.is(OrgIdSchema);

const isPlaybookId = Schema.is(PlaybookIdSchema);

const isPlaybookAccess = Schema.is(PlaybookAccessSchema);

describe('an org id', () => {
  it.each(['acme', 'Acme_Corp-1', 'a'.repeat(64)])('may be %s', (id) => {
    expect(isOrgId(id)).toBe(true);
  });

  it.each(['', 'a'.repeat(65), 'ac/me', 'ac me', 'acmé', 'acme:x'])('may not be %j', (id) => {
    expect(isOrgId(id)).toBe(false);
  });
});

describe('a playbook id', () => {
  it.each(['abc', 'alpha-2', `a${'b'.repeat(47)}`])('may be %s', (id) => {
    expect(isPlaybookId(id)).toBe(true);
  });

  it.each(['ab', 'Alpha', '1alpha', 'al_pha', `a${'b'.repeat(48)}`, 'alpha/beta'])('may not be %j', (id) => {
    expect(isPlaybookId(id)).toBe(false);
  });
});

describe('the playbooks a caller may access', () => {
  it('are every playbook or a list of playbook ids', () => {
    expect([isPlaybookAccess('*'), isPlaybookAccess([]), isPlaybookAccess(['alpha', 'beta'])]).toEqual([
      true,
      true,
      true,
    ]);
    expect([isPlaybookAccess('alpha'), isPlaybookAccess(['Alpha'])]).toEqual([false, false]);
  });
});

const toAcme = toOrg('acme');

const alphaWriter: CallerIdentity = { ...acmeAlphaReader, id: 'acme-alpha-writer', permissions: ['org:write'] };

const accessDenied = { status: 'rejected', reason: 'forbidden', detail: 'The caller may not access this playbook' };

describe('the playbook an org operation targets', () => {
  it('is its input field named playbook, wherever that field arrives from', async () => {
    const { dispatcher, run } = harness();

    expect(
      await run(
        dispatcher.dispatchToOrg(relabelPlaybook.registration, toAcme(alphaWriter, { playbook: 'beta', label: 'x' })),
      ),
    ).toEqual(accessDenied);
    expect(
      await run(
        dispatcher.dispatchToOrg(labelPlaybook.registration, toAcme(alphaWriter, { playbook: 'beta', label: 'x' })),
      ),
    ).toEqual(accessDenied);
    expect(
      await run(
        dispatcher.dispatchToOrg(relabelPlaybook.registration, toAcme(alphaWriter, { playbook: 'alpha', label: 'x' })),
      ),
    ).toEqual({ status: 'succeeded', output: { playbook: 'alpha', label: 'x' } });
  });

  it('is accessible only to a caller whose list holds it, whatever the field carries', async () => {
    const { dispatcher, run } = harness();
    const asking = (input: unknown) =>
      run(dispatcher.dispatchToOrg(getPlaybookLabel.registration, toAcme(acmeAlphaReader, input)));

    expect([await asking({ playbook: 'beta' }), await asking({ playbook: 7 })]).toEqual([accessDenied, accessDenied]);
    expect(await asking({ playbook: 'alpha' })).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'The playbook alpha has no label',
    });
  });
});

describe('an org operation that takes a playbook, called without one', () => {
  it('is refused to a caller limited to some playbooks, saying it may access only some and to name one', async () => {
    const { dispatcher, run } = harness();
    const unnamed = {
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller may access only some playbooks of this org; name one of them in playbook',
    };

    expect(await run(dispatcher.dispatchToOrg(getPlaybookLabel.registration, toAcme(acmeAlphaReader, {})))).toEqual(
      unnamed,
    );
    expect(
      await run(dispatcher.dispatchToOrg(relabelPlaybook.registration, toAcme(alphaWriter, { label: 'x' }))),
    ).toEqual(unnamed);
  });
});

describe('whether an org operation targets a playbook', () => {
  it('is recorded on the registration, and absent for an operation without a playbook field', async () => {
    const { dispatcher, run } = harness();

    expect(
      [relabelPlaybook, labelPlaybook, listPlaybookLabels].map(({ registration }) => registration.targetsPlaybook),
    ).toEqual([true, true, false]);
    expect(await run(dispatcher.dispatchToOrg(listPlaybookLabels.registration, toAcme(acmeAlphaReader)))).toEqual({
      status: 'succeeded',
      output: { labels: [] },
    });
  });
});

describe('the playbooks a caller may access', () => {
  it('are every playbook only for the star, and otherwise exactly the playbooks listed', async () => {
    const { dispatcher, run } = harness();
    const sloppy = { ...acmeAlphaReader };
    Reflect.set(sloppy, 'playbooks', 'alphabet-beta');

    expect(await run(dispatcher.dispatchToPlaybook(getNote.registration, toPlaybook('acme', 'alpha')(sloppy)))).toEqual(
      accessDenied,
    );
    expect(await run(dispatcher.dispatchToPlaybook(getNote.registration, toPlaybook('acme', 'beta')(sloppy)))).toEqual(
      accessDenied,
    );
    expect(
      await run(
        dispatcher.dispatchToPlaybook(getNote.registration, toPlaybook('acme', 'beta')(acmeAdmin, { name: 'anvil' })),
      ),
    ).toMatchObject({ reason: 'not_found', detail: 'There is no note anvil' });
  });

  it('are what canAccessPlaybook checks, for a handler that lists only the playbooks its caller may access', () => {
    expect([canAccessPlaybook('*', 'alpha'), canAccessPlaybook(['alpha'], 'alpha')]).toEqual([true, true]);
    expect([
      canAccessPlaybook(['alpha'], 'beta'),
      canAccessPlaybook([], 'alpha'),
      canAccessPlaybook(['alpha'], 7),
    ]).toEqual([false, false, false]);
  });
});
