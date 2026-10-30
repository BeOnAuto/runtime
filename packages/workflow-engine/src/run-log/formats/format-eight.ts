import type { OlderFormat } from '../state-format.ts';
import { initialOfFormatSeven, readFormatSeven } from './format-seven.ts';

export const formatEight: OlderFormat = {
  format: 8,
  initial: initialOfFormatSeven,
  read: (state) => readFormatSeven(state),
  upcast: (state) => readFormatSeven(state),
};
