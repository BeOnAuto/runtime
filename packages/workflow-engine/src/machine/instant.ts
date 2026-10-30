import { Schema } from 'effect';

export const InstantSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export function clampedAt(lastInputAt: number, at: number): number {
  return Math.max(lastInputAt, at);
}
