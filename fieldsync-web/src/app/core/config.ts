import { isDevMode } from '@angular/core';

// ng serve talks to the local API (see FieldSync.Api/Properties/launchSettings.json); production builds use the live one.
export const API_BASE = isDevMode() ? 'http://localhost:5080/api' : 'https://fieldsync-api-dp.azurewebsites.net/api';
