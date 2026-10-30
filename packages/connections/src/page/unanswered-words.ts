import { callWordsOf, type ConsentCall } from '@on.auto/tool-servers';

export function unansweredWordsOf(lead: string, call?: ConsentCall): string {
  if (call === undefined) {
    return `${lead}: a server it asks did not answer; try again in a moment`;
  }
  const { told, wait } = callWordsOf(call);
  return wait === undefined ? `${lead}: ${told}` : `${lead}: ${told}; ${wait}`;
}
