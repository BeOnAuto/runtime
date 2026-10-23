import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import type { MachineOptions } from '@on.auto/workflow-engine';
import { freshInstances, machineSandboxOf } from '@on.auto/workflow-engine/dsl';
import { defaultLimits, defaultSeed, testMachineOf } from '@on.auto/workflow-engine/testing';
import { Schema } from 'effect';
import { parse } from 'yaml';

import type { RunStart } from '../host/run-requests.ts';
import type { RunAddress } from '../runs/run-address.ts';

type JsonObject = typeof Schema.JsonObject.Type;

const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);

const header = { dsl: '1.0.3', namespace: 'acme', name: 'test', version: '1.0.0' };

export const testMachine: MachineOptions = testMachineOf(machineSandboxOf(freshInstances(shippedFilesOnDisk)));

export function workflow(source: string): JsonObject {
  return { document: header, ...decodeObject(parse(source)) };
}

export function runAt(runId: string): RunAddress {
  return { org: 'acme', playbook: 'alpha', runId };
}

const testAttributes: JsonObject = {
  org: 'acme',
  playbook: 'alpha',
  definition: { name: 'test', version: 1 },
  caller: { id: 'acme-admin' },
};

export function startOf(document: JsonObject, input: JsonObject = {}): RunStart {
  return { document, input, limits: defaultLimits, attributes: testAttributes, seed: defaultSeed };
}
