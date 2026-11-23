import type { HeldHere, LeaseHolders } from './arrival-parts.ts';

export function leaseHolders(): LeaseHolders {
  const holders = new Map<string, HeldHere>();
  return {
    heldHere: (conversation) => holders.get(conversation),
    held: (conversation, holding) => {
      const { promise: over, resolve: checkOver } = Promise.withResolvers<void>();
      holders.set(conversation, { holding, over });
      return {
        answering: () => {
          holders.set(conversation, { holding: 'turn', over });
          checkOver();
        },
        released: () => {
          holders.delete(conversation);
          checkOver();
        },
      };
    },
  };
}
