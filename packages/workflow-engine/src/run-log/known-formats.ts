import { formatEight } from './formats/format-eight.ts';
import { formatNine } from './formats/format-nine.ts';
import { formatSeven } from './formats/format-seven.ts';
import { formatTen } from './formats/format-ten.ts';
import { formatsOneToSix } from './formats/formats-one-to-six.ts';
import { stateFormat, type StateFormats } from './state-format.ts';

export const stateFormats: StateFormats = {
  current: stateFormat,
  older: [...formatsOneToSix, formatSeven, formatEight, formatNine, formatTen],
};
