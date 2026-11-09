import type { OlderFormat } from '../state-format.ts';
import { formatFive } from './format-five.ts';
import { formatFour } from './format-four.ts';
import { formatOne } from './format-one.ts';
import { formatSix } from './format-six.ts';
import { formatThree } from './format-three.ts';
import { formatTwo } from './format-two.ts';

export const formatsOneToSix: readonly OlderFormat[] = [
  formatOne,
  formatTwo,
  formatThree,
  formatFour,
  formatFive,
  formatSix,
];
