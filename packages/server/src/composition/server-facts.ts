import { MeterEventSchema } from '@on.auto/meter';

import { LicenseKeyEventSchema } from '../licensing/kept-license-key.ts';
import { OwnKeyEventSchema } from '../secrets/own-keys.ts';

export const serverFactSchemas = [MeterEventSchema, OwnKeyEventSchema, LicenseKeyEventSchema];
