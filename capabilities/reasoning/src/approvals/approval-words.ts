import { approvalBounds } from './approval-bounds.ts';

const needsApproval = "This action needs a person's approval";

export const nobodyMayApprove = `${needsApproval}, and the server says nobody can approve it for this call, so it was not done.`;

export const askedOneAtATime = `${needsApproval} too, and a run asks for one approval at a time, so it was not done. Make the call again once the other action is settled.`;

export const noWayToPassItOn = `${needsApproval}, and this runtime has no way to pass an approval on to the server, so it was not done.`;

export const noContentToGoOnFrom = `${needsApproval}, and this run cannot wait for one, since its tool servers keep no content for it to go on from, so it was not done.`;

export const approvalsSpent = `${needsApproval}, and this run has already asked for the ${approvalBounds.requestsInRun} approvals a run may, so it was not done.`;

export const nobodyToAsk = `${needsApproval}, and this run acts for nobody who can give it, so it was not done.`;

export const notPassedOn =
  'The person approved this action, but the approval could not be passed on to the server, so it was not done.';

export function noLongerOfferedWords(tool: string): string {
  return `The person approved this action, but the run no longer offers the tool ${tool}, since its server changed while the run waited, so it was not done.`;
}

export function declinedWords(reason?: string): string {
  const declined = 'The person declined this action, so it was not done.';
  return reason === undefined ? declined : `${declined} Their reason: ${reason}`;
}

export function expiredWords(expiresAt: string): string {
  return `Nobody approved this action before its approval expired at ${expiresAt}, so it was not done, and the server no longer holds the page it would have acted on. Start the task again from its first step; the action asks for approval again when you reach it.`;
}

export interface AskedOf {
  readonly functionName: string;
  readonly server: string;
  readonly tool: string;
  readonly action: string;
  readonly site?: string;
}

function placeOf({ server, tool, site }: AskedOf): string {
  const through = `the ${tool} tool of ${server}`;
  return site === undefined ? through : `${through}, on ${site}`;
}

export function requestMessageOf(asked: AskedOf): string {
  return [
    `${asked.functionName} needs your approval for this action, through ${placeOf(asked)}:`,
    asked.action,
    'Approve it to let the run take it once, or decline it.',
  ].join('\n\n');
}

export function waitingWords(server: string, expiresAt: string): string {
  return `An approval request is waiting for the person the run acts for to approve an action of ${server}, until ${expiresAt}.`;
}
