import { MeterEventSchema } from '@on.auto/meter';

import { LicenseKeyEventSchema } from '../licensing/kept-license-key.ts';
import { OwnKeyEventSchema } from '../secrets/own-keys.ts';
import { SignInClientEventSchema } from '../sign-in/client-registrations.ts';
import { SetupEventSchema } from '../sign-in/setup.ts';

export const serverFactSchemas = [
  MeterEventSchema,
  OwnKeyEventSchema,
  LicenseKeyEventSchema,
  SignInClientEventSchema,
  SetupEventSchema,
];
