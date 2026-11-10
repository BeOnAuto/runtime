import { formatEight } from './formats/format-eight.ts';
import { formatEleven } from './formats/format-eleven.ts';
import { formatNine } from './formats/format-nine.ts';
import { formatSeven } from './formats/format-seven.ts';
import { formatTen } from './formats/format-ten.ts';
import { formatsOneToSix } from './formats/formats-one-to-six.ts';
import { stateFormatKeepingPayloads, type StateFormats } from './state-format.ts';

export const stateFormats: StateFormats = {
  current: stateFormatKeepingPayloads,
  older: [...formatsOneToSix, formatSeven, formatEight, formatNine, formatTen, formatEleven],
};
