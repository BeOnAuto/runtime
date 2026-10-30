import {
  capabilityContract,
  firstLineOf,
  predictionCapabilityPoint,
  type ExtensionPoint,
  type ImplementationsProvided,
  type ProvidedImplementation,
} from '@on.auto/definitions';
import { listed } from '@on.auto/operations';
import { makePredictionFunctionAdapter, predictionDefinitionType } from '@on.auto/prediction';
import type { CapabilityFactory, CapabilityPorts, OwnSettings, ProvidedCapability } from '@on.auto/workflow-host';
import { Predicate, Result } from 'effect';

import { ExtensionRefused } from './extension-loading.ts';
import { providedCapabilityOf } from './provided-capabilities.ts';

type CapabilityMaker = (ports: CapabilityPorts) => unknown;

export type PortsOfTheServer = Omit<CapabilityPorts, 'settings'>;

export type FilledPoint = (ports: PortsOfTheServer) => ProvidedCapability;

export const predictionCapabilityFilled: ExtensionPoint<CapabilityMaker> = {
  name: predictionCapabilityPoint,
  contracts: { least: capabilityContract, most: capabilityContract },
  implementationOf: (value) =>
    Predicate.isFunction(value)
      ? Result.succeed((ports: CapabilityPorts): unknown => Reflect.apply(value, undefined, [ports]))
      : Result.fail('Expected a function that makes the capability from the ports the runtime hands it'),
};

const noSettings: OwnSettings = new Map();

function checkedOfType(made: unknown, type: string): Result.Result<ProvidedCapability, string> {
  return Result.flatMap(providedCapabilityOf(made), (provided) =>
    provided.capability.type === type
      ? Result.succeed(provided)
      : Result.fail(
          `it fills ${predictionCapabilityPoint} with a capability of the type ${provided.capability.type}, and the point takes one of the type ${type}`,
        ),
  );
}

function providedBy(
  { package: name, implementation }: ProvidedImplementation<CapabilityMaker>,
  ports: CapabilityPorts,
): ProvidedCapability {
  const refused = (detail: string) => new ExtensionRefused({ message: `The extension ${name} is refused: ${detail}` });
  const made = Result.try({ try: () => implementation(ports), catch: firstLineOf });
  if (Result.isFailure(made)) {
    throw refused(`it could not make its capability for ${predictionCapabilityPoint}: ${made.failure}`);
  }
  return Result.getOrThrowWith(checkedOfType(made.success, predictionDefinitionType), refused);
}

function keptToTheMostOf(make: CapabilityFactory): CapabilityFactory {
  return (ports) => {
    const provided = make(ports);
    return { ...provided, capability: { ...provided.capability, mostActive: ports.mostFunctions } };
  };
}

export function predictionCapabilityOf(
  provided: ImplementationsProvided,
  settingsOf: (extension: string) => OwnSettings,
): FilledPoint {
  const filling = provided(predictionCapabilityFilled);
  const [first] = filling;
  if (filling.length > 1) {
    throw new ExtensionRefused({
      message: `The extensions ${listed(filling.map(({ package: name }) => name))} each fill ${predictionCapabilityPoint}, and one extension at most may fill it; keep one of them in extensions`,
    });
  }
  if (first === undefined) {
    const forecaster = keptToTheMostOf(makePredictionFunctionAdapter);
    return (ports) => forecaster({ ...ports, settings: noSettings });
  }
  const extension = keptToTheMostOf((ports) => providedBy(first, ports));
  return (ports) => extension({ ...ports, settings: settingsOf(first.package) });
}
