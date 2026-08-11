/**
 * O59-b — the notification-catalog gate compares NAMES, not just a COUNT.
 *
 * Two gates already guard `notif_events` in `scripts/db-rebuild.sh`:
 *   - `notif_events`         : COUNT(*) == 34
 *   - `notif_katalog_sesuai` : COUNT(notif_events) == SUM(event_count)
 * Both count rows. Neither looks at a single event_type, its catalog_version, or
 * its resolver. A drift that keeps the count constant — a DB row seeded as
 * `plan_xyz` while TS spells it `plan_abc`, or the same event carrying
 * `leadsOfDivision` in one place and `explicitOrLeads` in the other — sails
 * through green. That blind spot is exactly what let SESI21's handoff report the
 * six Plan events "unregistered" (a `select code …` typo) while they sat in the
 * table the whole time: a name-level assertion would have said so on the spot.
 *
 * This test closes the class. It asserts the TypeScript `CATALOG` and the DB
 * `notif_events` are SET-EQUAL on (event_type, catalog_version, resolver), and
 * that the `notif_catalog_versions` registry matches `CATALOG_VERSIONS`
 * one-for-one. Adding an event on one side without the other now fails by name,
 * not by a count that two mistakes can cancel out.
 *
 * Skipped unless DATABASE_URL is set (same convention as the other *.reals /
 * RLS suites).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { notification } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) {
  sql = createClient(URL);
}

/** Canonical, order-independent key for one catalog entry. */
const entryKey = (e: { event_type: string; catalog_version: number; resolver: string }): string =>
  `${e.event_type}|v${e.catalog_version}|${e.resolver}`;

describeDb('O59-b — notif catalog: DB and TypeScript agree by NAME, not count', () => {
  afterAll(async () => {
    if (sql) await sql.end();
  });

  it('notif_events is set-equal to CATALOG on (event_type, version, resolver)', async () => {
    const dbRows = await sql<
      { event_type: string; catalog_version: number; resolver: string }[]
    >`select event_type, catalog_version, resolver from notif_events`;

    const tsRows = notification.events().map((e) => ({
      event_type: e,
      catalog_version: notification.CATALOG[e].version,
      resolver: notification.CATALOG[e].resolver,
    }));

    const dbSet = new Set(dbRows.map(entryKey));
    const tsSet = new Set(tsRows.map(entryKey));

    // Sorted arrays so a mismatch prints the offending names, not just "not equal".
    const onlyInDb = [...dbSet].filter((k) => !tsSet.has(k)).sort();
    const onlyInTs = [...tsSet].filter((k) => !dbSet.has(k)).sort();
    expect({ onlyInDb, onlyInTs }).toEqual({ onlyInDb: [], onlyInTs: [] });
  });

  it('notif_catalog_versions matches CATALOG_VERSIONS by (version, event_count)', async () => {
    const dbVersions = await sql<
      { version: number; event_count: number }[]
    >`select version, event_count from notif_catalog_versions order by version`;

    const tsVersions = [...notification.CATALOG_VERSIONS]
      .map((v) => ({ version: v.version, event_count: v.eventCount }))
      .sort((a, b) => a.version - b.version);

    expect(dbVersions.map((v) => ({ version: v.version, event_count: v.event_count }))).toEqual(
      tsVersions,
    );
  });

  it('every catalog version accounts for exactly its own events in both stores', async () => {
    // Per-version SUM: the aggregate gate (SUM == COUNT) can be satisfied while a
    // single version is over- and another under-counted. This pins each version.
    const dbPerVersion = await sql<{ catalog_version: number; n: number }[]>`
      select catalog_version, count(*)::int as n
        from notif_events group by catalog_version order by catalog_version`;

    for (const v of notification.CATALOG_VERSIONS) {
      const dbCount = dbPerVersion.find((r) => r.catalog_version === v.version)?.n ?? 0;
      const tsCount = notification.eventsOfVersion(v.version).length;
      expect({ version: v.version, dbCount, tsCount, declared: v.eventCount }).toEqual({
        version: v.version,
        dbCount: v.eventCount,
        tsCount: v.eventCount,
        declared: v.eventCount,
      });
    }
  });
});
