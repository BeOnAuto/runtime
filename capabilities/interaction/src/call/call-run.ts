import { functionResourceLabels } from '@on.auto/definitions';
import { callRunOf, type CallPorts } from '@on.auto/definitions/tool-blocks';

export function callRun(ports: CallPorts) {
  return callRunOf(ports, { noun: functionResourceLabels.interaction.singular });
}
