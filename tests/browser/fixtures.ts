import {test as base, expect, _electron} from '@playwright/test';
import {closePools} from '../../apps/server/src/db/pools.js';

// Specs share the imported database pools within a worker. Close them only when
// that worker ends, after every file using the pools has completed.
export const test = base.extend<{}, {databaseLifetime: void}>({
  databaseLifetime: [async ({}, use) => {
    try { await use(); } finally { await closePools(); }
  }, {scope: 'worker', auto: true}],
});
export {expect, _electron};
