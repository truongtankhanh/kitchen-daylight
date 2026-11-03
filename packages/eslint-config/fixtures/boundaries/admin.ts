// Boundary fixture for admin: every "expect" line must be reported, every other line must lint clean.

import '@kd/api'; // expect: no-restricted-imports
import '@kd/api/src/internal.js'; // expect: no-restricted-imports
import '../../../../apps/api/src/main.js'; // expect: no-restricted-imports
import '@kd/mobile'; // expect: no-restricted-imports
import '@kd/mobile/src/internal.js'; // expect: no-restricted-imports
import '../../../../apps/mobile/src/main.js'; // expect: no-restricted-imports
import '@kd/seed'; // expect: no-restricted-imports
import '@kd/seed/src/internal.js'; // expect: no-restricted-imports
import '../../../../tools/seed/src/main.js'; // expect: no-restricted-imports
import '@kd/seed-data'; // expect: no-restricted-imports
import '@kd/seed-data/src/internal.js'; // expect: no-restricted-imports
import '../../../../tools/seed-data/src/main.js'; // expect: no-restricted-imports
import '../../../../designs/web/brief.md'; // expect: no-restricted-imports

import '@kd/contracts';
import '@kd/contracts/client';
import '@kd/design-tokens';
import '@kd/i18n';
import './local.js';
import '../shared/designs-helper.js';
