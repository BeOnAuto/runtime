import { cutToFailureBound } from '../bounds/call-bounds.ts';
import type { Served } from '../org-servers/org-servers.ts';
import type { Unusable } from '../org-servers/server-refusals.ts';
import { everyPlaybook } from '../settings/server-settings.ts';
import type { AvailableServer, ServerFields, ServerTool, UnavailableServer } from './tool-server.ts';

export function serverFieldsOf({
  name,
  type,
  record_content,
  playbooks,
  connection,
  provider,
  handles_money: handlesMoney,
  renders,
}: Served): ServerFields {
  return {
    name,
    type,
    record_content,
    playbooks: playbooks ?? [everyPlaybook],
    ...(connection === null ? {} : { connection }),
    provider,
    ...(handlesMoney === true ? { handles_money: handlesMoney } : {}),
    ...(renders === undefined ? {} : { renders }),
  };
}

export function availableServer(settings: Served, tools: readonly ServerTool[]): AvailableServer {
  return { ...serverFieldsOf(settings), tools };
}

export function unavailableServer(settings: Served, { because, detail }: Unusable): UnavailableServer {
  return { ...serverFieldsOf(settings), unavailable: cutToFailureBound(detail), because };
}
