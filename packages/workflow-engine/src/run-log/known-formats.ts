import { formatEight } from './formats/format-eight.ts';
import { formatFive } from './formats/format-five.ts';
import { formatFour } from './formats/format-four.ts';
import { formatNine } from './formats/format-nine.ts';
import { formatOne } from './formats/format-one.ts';
import { formatSeven } from './formats/format-seven.ts';
import { formatSix } from './formats/format-six.ts';
import { formatThree } from './formats/format-three.ts';
import { formatTwo } from './formats/format-two.ts';
import { stateFormat, type StateFormats } from './state-format.ts';

export const stateFormats: StateFormats = {
  current: stateFormat,
  older: [formatOne, formatTwo, formatThree, formatFour, formatFive, formatSix, formatSeven, formatEight, formatNine],
};
