/**
 * update-galaxy-bootstrap.ts
 *
 * Force-refreshes data/galaxy_bootstrap.json from the game's public /api/map endpoint.
 * Delegates all fetch/strip/save logic to publicCatalog.fetchGalaxy().
 *
 * Run with:  bun src/scripts/update-galaxy-bootstrap.ts
 *
 * The saved file is used by MapStore.seedFromBootstrapFile() at startup when the DB
 * is empty so that pathfinding works immediately without waiting for bot exploration.
 * In normal operation this file is refreshed automatically every 24h by botmanager.
 */

import { publicCatalog } from "../publicCatalog.js";

console.log("Fetching galaxy topology from game API...");
publicCatalog.fetchGalaxy()
  .then(() => {
    const count = publicCatalog.getGalaxySystems().length;
    console.log(`Done — ${count} systems saved to data/galaxy_bootstrap.json`);
  })
  .catch((err: unknown) => {
    console.error("Failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
