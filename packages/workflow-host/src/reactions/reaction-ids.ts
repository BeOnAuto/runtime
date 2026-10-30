import { uuidV5 } from '@on.auto/operations';

const reactionStarts = '3c9e1f04-7b2a-5d68-8e41-0a6f5c2d9b73';

export function reactionRunIdOf(workflow: string, version: number, reference: string, cause: string): string {
  return uuidV5(reactionStarts, JSON.stringify([workflow, version, reference, cause]));
}
