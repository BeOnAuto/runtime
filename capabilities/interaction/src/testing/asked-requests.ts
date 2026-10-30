import { approvalDocument, chatDelivery, notificationDocument } from './documents.ts';
import { fakeTools, type FakeTools } from './fake-tools.ts';
import { interactionHarness, type HarnessLedger, type InteractionHarness } from './interaction-harness.ts';

export const askedRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export interface AskedRequest {
  readonly playbook: InteractionHarness;
  readonly tools: FakeTools;
  readonly askedAt: number;
}

export interface AskingOptions {
  readonly notification?: boolean;
  readonly expires?: string;
  readonly ledger?: HarnessLedger;
  readonly delivery?: readonly string[];
}

export async function askedThroughChat(options: AskingOptions = {}): Promise<AskedRequest> {
  const tools = fakeTools();
  const playbook = interactionHarness({ tools, ledger: options.ledger });
  const expires = options.expires ?? 'P2D';
  const delivery = options.delivery ?? chatDelivery;
  await playbook.define(
    'approve-brief',
    options.notification === true ? notificationDocument(delivery, expires) : approvalDocument(delivery, expires),
  );
  await playbook.ask('approve-brief', { campaign: 'Spring', owner: 'ada' }, askedRunId);
  return { playbook, tools, askedAt: Date.now() };
}
