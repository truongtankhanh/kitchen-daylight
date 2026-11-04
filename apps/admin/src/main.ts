import { bootstrapApplication } from '@angular/platform-browser';

import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  // The only console output of the shell: a failed bootstrap leaves a blank page otherwise.
  // eslint-disable-next-line no-console
  console.error(error);
});
