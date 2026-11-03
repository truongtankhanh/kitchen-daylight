// Boundary fixture for api: every "expect" line must be reported, every other line must lint clean.

import '@kd/admin'; // expect: no-restricted-imports
import '@kd/admin/src/internal.js'; // expect: no-restricted-imports
import '../../../../apps/admin/src/main.js'; // expect: no-restricted-imports
import '@kd/mobile'; // expect: no-restricted-imports
import '@kd/mobile/src/internal.js'; // expect: no-restricted-imports
import '../../../../apps/mobile/src/main.js'; // expect: no-restricted-imports
import '@kd/design-tokens'; // expect: no-restricted-imports
import '@kd/design-tokens/src/internal.js'; // expect: no-restricted-imports
import '../../../../packages/design-tokens/src/main.js'; // expect: no-restricted-imports
import '@kd/seed'; // expect: no-restricted-imports
import '@kd/seed/src/internal.js'; // expect: no-restricted-imports
import '../../../../tools/seed/src/main.js'; // expect: no-restricted-imports
import '@kd/seed-data'; // expect: no-restricted-imports
import '@kd/seed-data/src/internal.js'; // expect: no-restricted-imports
import '../../../../tools/seed-data/src/main.js'; // expect: no-restricted-imports
import '@kd/contracts/client'; // expect: no-restricted-imports
import '../../../../packages/contracts/src/client.js'; // expect: no-restricted-imports
import '../../../../packages/contracts/src/generated/openapi.js'; // expect: no-restricted-imports
import '../../../../designs/web/brief.md'; // expect: no-restricted-imports

import '@kd/contracts';
import '@kd/i18n';
import './local.js';
import '../shared/designs-helper.js';
