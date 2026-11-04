import { provideBrowserGlobalErrorListeners } from '@angular/core';
import type { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { primeNgPreset } from '@kd/design-tokens/primeng';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import { providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';

// Aura extended with the design tokens (decision 0006 item 7, @kd/design-tokens README).
const kdPreset = definePreset(Aura, primeNgPreset);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    providePrimeNG({
      theme: {
        preset: kdPreset,
        options: {
          prefix: 'p',
          // The preset's light-dark() values follow `color-scheme`, which
          // @kd/design-tokens/css sets for the system preference and both data-theme overrides.
          darkModeSelector: "[data-theme='dark']",
          // PrimeNG styles in a CSS layer, so the admin's own styles win without !important.
          cssLayer: true,
        },
      },
      // `license` (the PrimeUI Community License key, decision 0001) is not set yet: it is
      // configuration, never committed, and where the build reads it is not decided.
    }),
  ],
};
