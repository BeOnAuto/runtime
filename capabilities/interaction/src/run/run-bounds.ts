export const interactionBounds = {
  toBytes: 256,
  messageBytes: 8192,
  answerBytes: 65_536,
  answerDepth: 512,
  claimBytes: 256,
  shortestExpiryMs: 60_000,
  longestExpiryMs: 2_592_000_000,
  openRequests: 10_000,
} as const;
