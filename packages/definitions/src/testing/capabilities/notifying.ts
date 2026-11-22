import { defineCapability } from '../../index.ts';
import { echoDeclaration } from './echo.ts';

export const notifying = defineCapability({ ...echoDeclaration, type: 'interaction', guide: { name: 'interaction' } });
