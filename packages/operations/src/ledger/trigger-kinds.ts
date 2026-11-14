import { Schema } from 'effect';

export const triggerKinds = ['event', 'cron', 'every', 'goal'] as const;

export type TriggerKind = (typeof triggerKinds)[number];

export const triggerKindsInWords = `${triggerKinds.slice(0, -1).join(', ')} or ${triggerKinds.slice(-1).join('')}`;

export const TriggerKindSchema = Schema.Literals(triggerKinds);
