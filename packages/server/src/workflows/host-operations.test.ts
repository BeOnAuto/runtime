import { editorRoleForEveryPerson, loadedMessage } from '@on.auto/access-control';
import { echo } from '@on.auto/definitions/testing';
import { makeDispatcher, playbookCallerOf, reportedDifferenceMessage, type PlaybookRequest } from '@on.auto/operations';
import { capturedLogs, memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { decisionPointServing } from '../composition/served-access-control.ts';
import { shippedRoots } from '../server-options/shipped-roots.ts';
import { hostDispatchesOf, hostOperationsOf, hostRegistrationsOf } from './host-operations.ts';

const asAlphaItself: PlaybookRequest = {
  caller: playbookCallerOf({ org: 'acme', playbook: 'alpha' }),
  org: 'acme',
  playbook: 'alpha',
  input: {},
  encoding: 'json',
};

const services = Layer.mergeAll(
  memoryLedger().layer,
  memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
  recordingReporter().layer,
);

describe('the operations the workflow host is handed', () => {
  it('are its two own, the start of a version and the run of a definition, each the playbook operation it dispatches', () => {
    const host = hostOperationsOf([echo]);

    expect(hostRegistrationsOf(host).map(({ scope, name }) => `${scope}/${name}`)).toEqual([
      'playbook/start_definition_version',
      'playbook/run_definition',
    ]);
  });

  it('are each declared to the decision point the server composes, so each dispatch the host is handed is decided as the check decides it', async () => {
    const host = hostOperationsOf([echo]);
    const reporting = makeDispatcher([], {
      reportOnly: decisionPointServing(
        { catalogs: [], host },
        shippedFilesOnDisk(shippedRoots),
        editorRoleForEveryPerson,
      ),
    });
    const logs = capturedLogs();

    await Effect.runPromise(
      Effect.forEach(Object.values(hostDispatchesOf(reporting, host)), (dispatch) => dispatch(asAlphaItself)).pipe(
        Effect.provide(logs.layer),
        Effect.provide(services),
      ),
    );

    expect(logs.logged().filter(({ message }) => message === reportedDifferenceMessage)).toEqual([]);
    expect(logs.logged().filter(({ message }) => message === loadedMessage)).toMatchObject([
      { annotations: { operations: hostRegistrationsOf(host).length } },
    ]);
  });
});
