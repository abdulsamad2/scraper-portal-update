# Inventory Sync Migration Design: Automatiq CSV → StubHub POS API

**Date:** 2026-06-02 · **Audience:** Brian (repo owner)
**Repo:** `scraper-portal-update` (Next.js App Router, server actions, MongoDB/Mongoose, node-cron)
**Status:** Design — implementation not started

---

## 1. TL;DR Recommendation

Introduce a single `InventorySyncProvider` interface and route **all** push/delete traffic through it at exactly the three seams identified (`uploadCsvToSyncService`, `deleteInventoryBatchFromSync`, and the in-memory `CsvRow[]` inside `generateInventoryCsv`). Ship two implementations — `CsvSyncProvider` (a thin wrapper around today's `SyncService`, the **legacy fallback**) and `StubHubApiProvider` (new `lib/stubhub/` client) — and select between them with a new `inventorySyncProvider` feature flag on the existing `FeatureFlags` model plus a `STUBHUB_*` env block. Because StubHub has **no bulk upload** and create returns the only durable id, the API path must abandon "replace the whole CSV every cycle" in favor of a **diff-based reconcile** keyed off a new persisted `inventory.stubhubListingId` and the `/inventory/export` feed; the single hard blocker is event-id coverage (only ~2,035 events carry a 9-digit StubHub id today), so make the provider **skip + log** any event whose `mapping_id` isn't StubHub-shaped and keep CSV dormant-but-selectable as the escape hatch.

---

## 2. Architecture: the `InventorySyncProvider` seam

### 2.1 Interface

New file `lib/sync/InventorySyncProvider.ts`. The interface is intentionally **row-oriented** (takes `CsvRow[]`, not serialized CSV text), because the cleanest seam is the in-memory `filteredRecords: CsvRow[]` already present inside `generateInventoryCsv` before serialization — the StubHub provider must not have to re-parse a CSV.

```ts
// lib/sync/InventorySyncProvider.ts
import type { CsvRow } from '@/actions/csvActions'; // CsvRow interface lives at csvActions.tsx:42

export interface PushResult {
  success: boolean;
  message: string;
  pushed: number;                 // rows accepted
  skipped: number;                // rows dropped (e.g. no StubHub eventId)
  uploadId?: string;              // CSV: Automatiq uploadId. StubHub: synthetic batch id.
  perRow?: Array<{                // StubHub only; CSV leaves undefined
    inventoryId: number;          // our scraper inventoryId (join key)
    stubhubListingId?: string;    // id returned by POST /inventory
    status: 'created' | 'updated' | 'skipped' | 'failed';
    reason?: string;
  }>;
}

export interface DeleteResult {
  success: boolean;
  message: string;
  successful: string[];           // ids we confirmed removed
  failed: string[];
}

export interface InventorySyncProvider {
  readonly name: 'csv' | 'stubhub';

  /** Full push of the current book (rows already filtered/marked-up). */
  pushInventory(rows: CsvRow[], opts?: { allowBlank?: boolean }): Promise<PushResult>;

  /** Remove listings. Input is OUR scraper inventoryIds (as strings),
   *  exactly as deleteInventoryBatchFromSync receives them today. */
  deleteInventory(inventoryIds: string[]): Promise<DeleteResult>;
}
```

`CsvRow` must be `export`ed from `actions/csvActions.tsx` (it is currently a local `interface` at L42) so both providers and the resolver can import it.

### 2.2 Provider selection

New file `lib/sync/getProvider.ts`. Selection reuses the existing `FeatureFlags` doc (`models/featureFlagModel.js`) — add one field:

```js
// models/featureFlagModel.js  — add alongside csvScheduler/csvManualExport
inventorySyncProvider: { type: String, enum: ['csv', 'stubhub'], default: 'csv' },
```

> Note: this field is a **provider selector**, not a tri-state `enabled/hidden/disabled` `flagType`. Keep it as its own enum so it doesn't get normalized by `isFeatureVisible`/`requireFeatureFlag` in `lib/featureFlags.ts`. Leave the existing `exportCsv`/`csvScheduler`/`csvManualExport` flags as-is — they continue to gate the *UI surfaces*; the new field decides *where bytes go*.

```ts
// lib/sync/getProvider.ts
import dbConnect from '@/lib/dbConnect';
import { FeatureFlags } from '@/models/featureFlagModel.js';
import { CsvSyncProvider } from './CsvSyncProvider';
import { StubHubApiProvider } from './StubHubApiProvider';
import type { InventorySyncProvider } from './InventorySyncProvider';

export async function getInventorySyncProvider(): Promise<InventorySyncProvider> {
  // Env kill-switch always wins (lets us force-revert without a DB write).
  if (process.env.INVENTORY_SYNC_PROVIDER === 'csv')     return new CsvSyncProvider();
  if (process.env.INVENTORY_SYNC_PROVIDER === 'stubhub') return new StubHubApiProvider();

  await dbConnect();
  const flags = await FeatureFlags.findOne({}).lean();
  const choice = (flags as any)?.inventorySyncProvider ?? 'csv';
  return choice === 'stubhub' ? new StubHubApiProvider() : new CsvSyncProvider();
}
```

Precedence: **env var > feature flag > default `'csv'`**. The env override is the production panic-button (set `INVENTORY_SYNC_PROVIDER=csv` in PM2 and restart → instant revert, no DB access required).

### 2.3 Where it slots into the existing call-sites

The whole point is that **call-sites barely change**. We refactor the three seam functions in `actions/csvActions.tsx` / `actions/seatActions.ts` to delegate to the selected provider; everything upstream keeps calling the same exported functions.

**Seam 1 — push.** `uploadCsvToSyncService` (`csvActions.tsx:1142`) today takes serialized `csvContent: string`. We keep that signature for backward compat (Danger Zone still needs raw-string upload), **but add** a sibling that takes rows:

```ts
// actions/csvActions.tsx  (new, the preferred push entry-point)
export async function pushInventoryToSyncService(
  rows: CsvRow[],
  opts?: { allowBlank?: boolean }
): Promise<{ success: boolean; message: string; uploadId?: string }> {
  const provider = await getInventorySyncProvider();
  // Preserve the blank-guard: only Danger Zone passes allowBlank.
  if (!opts?.allowBlank && rows.length === 0) {
    return { success: false, message: 'Refusing to push 0 records (blank guard).' };
  }
  const res = await provider.pushInventory(rows, opts);
  // Keep writing SchedulerSettings.lastUpload* exactly as today (csvActions.tsx:1184/1208)
  await updateSchedulerSettings({
    lastUploadAt: new Date(),
    lastUploadStatus: res.success ? 'success' : 'failed',
    lastUploadId: res.uploadId,
    lastUploadError: res.success ? undefined : res.message,
  });
  // StubHub: persist returned listing ids (see §4).
  if (res.perRow) await persistStubhubListingIds(res.perRow);
  return { success: res.success, message: res.message, uploadId: res.uploadId };
}
```

Then change the call-sites that currently do `generateInventoryCsv → uploadCsvToSyncService(result.csv)` to instead hand over the rows:

- **Cron scheduler** `app/api/csv-scheduler/route.ts:156/174` — `generateInventoryCsv` already builds `filteredRecords`; expose those rows on its return (add `rows?: CsvRow[]` to the result) and call `pushInventoryToSyncService(result.rows)` when `uploadToSync`. Keep the 0-record refusal at `:212-224`.
- **Manual export+upload** `app/api/export-csv/route.ts:19/40` — same swap; keep the 0-record refusal at `:29`.
- **Danger Zone** `app/api/danger-upload-csv/route.ts:48` — this is the **only** path allowed to push blank, and it's CSV-string-native. Leave it calling `new SyncService(...).uploadCsvContentToSync(csvContent)` **directly** (it explicitly bypasses the guard, gated by `confirm === 'UPLOAD'` at `:33`). When the StubHub provider is active, Danger Zone has no analog — so it should hard-fail with "raw CSV upload unavailable in StubHub mode; switch provider to csv" rather than silently do nothing. This keeps the dangerous blank-wipe a CSV-only capability.
- **Generate-to-file** `app/api/generate-csv/route.ts` — download-only, **never** touches a provider. No change.

**Seam 2 — delete.** `deleteInventoryBatchFromSync` (`csvActions.tsx:1231`) body becomes:

```ts
export async function deleteInventoryBatchFromSync(inventoryIds: string[]) {
  if (!inventoryIds.length) return { success: true, message: 'No ids', successful: [], failed: [] };
  const provider = await getInventorySyncProvider();
  return provider.deleteInventory(inventoryIds);
}
```

All four delete call-sites (`seatActions.ts:276/328`, auto-delete cron, low-seat auto-stop) are untouched — they already filter blank ids (`seatActions.ts:262/317`), and that guard stays.

### 2.4 `CsvSyncProvider` (legacy)

```ts
// lib/sync/CsvSyncProvider.ts — wraps TODAY's code verbatim
export class CsvSyncProvider implements InventorySyncProvider {
  readonly name = 'csv' as const;

  async pushInventory(rows: CsvRow[], opts?) {
    const csv = generateCsvString(rows);            // csvActions.tsx:901 (reuse)
    const svc = new SyncService(process.env.SYNC_COMPANY_ID!, process.env.SYNC_API_TOKEN!);
    const res = await withRetry(                    // keep the 5-retry/2s/30s upload config (csvActions.tsx:1219)
      () => raceTimeout(svc.uploadCsvContentToSync(csv), 180_000), // 180s cap (csvActions.tsx:1169)
      { retries: 5, baseMs: 2000, maxMs: 30000 });
    return { success: res.success, message: res.message ?? '', pushed: rows.length, skipped: 0, uploadId: res.uploadId };
  }

  async deleteInventory(ids: string[]) {
    const svc = new SyncService(process.env.SYNC_COMPANY_ID!, process.env.SYNC_API_TOKEN!);
    const r = await svc.deleteInventoryBatch(ids);  // syncService.js:196 (one POST, all ids)
    return { success: true, message: `deleted ${r.deleted}`, successful: ids, failed: [] };
  }
}
```

This is a refactor, not a rewrite — it literally re-invokes `SyncService` and `generateCsvString` so the legacy path is byte-for-byte what runs today. The serialization moves *inside* the CSV provider, which is exactly right: only the CSV provider cares about CSV text.

---

## 3. `StubHubApiProvider` design (`lib/stubhub/`)

### 3.1 Module layout

```
lib/stubhub/
  client.ts        // auth headers, fetchWithTimeout, retry/backoff, 429-aware loop
  types.ts         // InventoryCreateRequest, ListingResource, etc.
  mapRow.ts        // CsvRow -> InventoryCreateRequest / patch bodies (§6)
  eventResolver.ts // mapping_id -> StubHub eventId (§5)
  provider.ts      // StubHubApiProvider implements InventorySyncProvider
  reconcile.ts     // diff loop against /inventory/export (§4)
```

### 3.2 `client.ts` — auth, transport, rate-limit aware

Every request sends:

```
Authorization: Bearer ${STUBHUB_BEARER_TOKEN}
Account-Id: ${STUBHUB_ACCOUNT_ID}            // 6521964d-... seller GUID
Content-Type: application/json               // writes only
```

Base host `https://pointofsaleapi.stubhub.net` (no `servers` block in spec — hardcode + env-override `STUBHUB_BASE_URL` for sandbox vs prod).

Reuse the **existing transport primitives** rather than inventing new ones:
- `fetchWithTimeout` + `AbortController` pattern from `syncService.js:17` (default 30s).
- `withRetry` from `csvActions.tsx:214` (exp backoff + jitter). **Flatten** the nesting — the StubHub client owns retry; the provider must **not** wrap it again, so we avoid the 5×3 worst-case. One retry layer, here.

Rate-limit awareness (replaces the one-shot CSV upload):

```ts
// concurrency-limited worker pool — writes are one-at-a-time, no bulk.
const POOL = Number(process.env.STUBHUB_CONCURRENCY ?? 4);

async function runPool<T>(items: T[], worker: (t: T) => Promise<void>) { /* p-limit style */ }

// 429 handling: spec declares NO rate-limit headers.
// Respect Retry-After if present; else exponential backoff starting 2s, cap 60s,
// and DROP global concurrency by 1 on repeated 429s (adaptive throttle).
```

Because there is **no batch create**, a "push" is `O(changed listings)` sequential-ish writes through the pool, not one HTTP call. This is the single biggest behavioral change from CSV and the reason §4's diff is mandatory (we must never POST the whole book every cycle).

### 3.3 Lifecycle mapping

| Our op | StubHub call(s) |
|---|---|
| **Create new listing** | `POST /inventory` (`InventoryCreateRequest`) → 201 `ListingResource`; capture `id` (int64 = StubHub inventoryId) and `tickets[].id`. Then **follow-up `PATCH /inventory/{id}`** to set price/broadcast — *create has no price field*. |
| **Update price/changed row** | `PATCH /inventory/{inventoryId}` with `prices[]` (`listPrice`/`allInPrice`), `splitType`, `deliveryType`, `tags[]`, `inHandAt`, `hideSeats`. |
| **Delete** | `DELETE /inventory/{inventoryId}` (must not be attached to a PO). Loop per id with concurrency pool. |
| **Barcodes / per-seat** | `PATCH /inventory/{inventoryId}` `barcodes[]` keyed by `ticketId` — **after** create. Rarely populated by our scraper; defer (see §8). |

Because create yields an unpriced listing, the **create flow is two calls**: `POST /inventory` then `PATCH …/{id}` with `prices[]` + `autoBroadcast`/`broadcastStatuses`. Treat this as one logical "create" unit in the pool and only persist `stubhubListingId` after both succeed (otherwise we'd orphan an unbroadcast listing). **Confirm with StubHub whether create-with-price is possible** to collapse to one call.

---

## 4. Reconciliation strategy

The CSV path gets "full snapshot replace" for free (Automatiq re-ingests the whole file). The API path has no such thing, so we **reconstruct snapshot-replace semantics with a diff**.

### 4.1 Where to store the link

Add **one persisted field** on the inventory subdoc (our existing `inventory.inventoryId` is the *scraper's* number, not StubHub's):

```js
// models/seatModel.js  — ConsecutiveGroup.inventory.*  (next to inventoryId at :145)
stubhubListingId: { type: String, index: true },   // StubHub POST /inventory -> id (int64 as string)
stubhubSyncedAt:  { type: Date },
stubhubSyncHash:  { type: String },                 // hash of the pushed body, to detect "changed"
```

**Why on the subdoc, not a separate collection:** the join key (`inventory.inventoryId`) already lives here, every delete path already reads `group.inventory.inventoryId` (`seatActions.ts:260/315`), and we want delete to switch its target id with a one-line change. A separate `syncState` collection would duplicate the group↔inventory relationship and add a join to every delete. Co-locating keeps the blank-guard and `.toString()` logic (`seatActions.ts:262/317`) intact — we just resolve `stubhubListingId` instead of `inventoryId` when the provider is StubHub.

`externalId` on the StubHub side carries `String(inventory.inventoryId)` so we can re-derive the link from `/inventory/export` if `stubhubListingId` is ever lost.

### 4.2 The diff algorithm (per push cycle)

Input: `rows: CsvRow[]` (already filtered + marked-up, exactly what `generateInventoryCsv` produced).

```
1. RESOLVE eventIds: for each row, mapping_id -> StubHub eventId (§5).
   - unresolved -> bucket into `skipped`, log once per eventId, DO NOT POST.

2. LOAD live set: GET /inventory/export?updatedDateSince=<lastSyncWatermark>&includeDeleted=true
   - paginate via paginationToken; build Map<externalId(=our inventoryId)> -> {stubhubId, hash, prices}.
   - also read our own ConsecutiveGroup docs to get stored stubhubListingId per inventoryId.

3. DIFF each resolved row by our inventoryId:
   a. not in StubHub (no stubhubListingId, not in export)  -> CREATE  (POST + PATCH price/broadcast)
   b. in StubHub, body hash changed (price/split/qty/etc.) -> PATCH    (prices[], splitType, ...)
   c. in StubHub, hash unchanged                           -> NO-OP
   d. in StubHub but NOT in this row set                   -> candidate DELETE
      (mirrors CSV "row absent => removed". Guard: only delete if not attached to a PO;
       on 409/PO-attached, log + leave.)

4. EXECUTE through the concurrency pool (§3.2): creates first, then patches, then deletes.
   - persist stubhubListingId + stubhubSyncHash + stubhubSyncedAt after each success.

5. ADVANCE watermark (max updatedDate seen) for next incremental export.
```

The `stubhubSyncHash` lets step 3b be a cheap local comparison so steady-state cycles only emit deltas — `O(changed)` writes, not `O(book)`. This is what makes the no-bulk-create constraint survivable at production volume (~2k events).

**Critical safety carryover:** the CSV blank-guard exists because pushing an empty file wipes Automatiq. The API analog is step 3d: if event resolution fails wholesale (e.g. token expired → 0 rows resolve), the diff would try to DELETE the entire book. **Add a circuit breaker:** if `skipped / total > SKIP_ABORT_RATIO` (e.g. 0.5) or resolved rows == 0, **abort the whole cycle** and write `lastUploadStatus:'failed'` — never mass-delete on a resolution failure.

---

## 5. Event-id resolution

The marketplace identity lives in **one field**: `Event.mapping_id` (`models/eventModel.js:5`, String, unique). After `scripts/replaceStubhubMappingIds.js --apply`, ~2,035 events hold a **9-digit StubHub eventId**; the rest still hold a **7-digit Vivid production id** that is useless to StubHub. There is no GUID stored anywhere.

### 5.1 Resolver (`lib/stubhub/eventResolver.ts`)

```ts
const STUBHUB_ID = /^[0-9]{9}$/;     // 9 digits ≈ StubHub eventId
const VIVID_ID   = /^[0-9]{7}$/;     // 7 digits ≈ legacy Vivid (NOT usable)

export function resolveStubhubEventId(event: { mapping_id?: string }):
  { ok: true; eventId: number } | { ok: false; reason: 'no-mapping' | 'legacy-vivid' | 'bad-shape' } {
  const m = event.mapping_id?.trim();
  if (!m) return { ok: false, reason: 'no-mapping' };
  if (STUBHUB_ID.test(m)) return { ok: true, eventId: parseInt(m, 10) }; // feed EventRequest.id
  if (VIVID_ID.test(m))   return { ok: false, reason: 'legacy-vivid' };
  return { ok: false, reason: 'bad-shape' };
}
```

`POST /inventory` takes `event: { id: int32 }`, so a 9-digit id → `parseInt` → `EventRequest.id`. Done, no network lookup for migrated events.

### 5.2 Handling events lacking a usable mapping

An unmigrated 7-digit Vivid id **cannot be resolved to a StubHub eventId from what we store**, and there is **no event search-by-name/date API**. So:

- **Default policy: skip + log, do not fall back to CSV per-event.** Mixing providers per-event mid-cycle would split the book across two marketplaces and double-list. Skipped rows go to `createErrorLog` (the existing error sink) with reason `legacy-vivid`/`no-mapping`, counted into `PushResult.skipped`, and surfaced on the dashboard next to `lastUploadStatus`.
- **`EventMappingRequest` as an optional enrichment, not a default.** Create accepts `eventMapping` (name/date/venue/city/state/country) **instead of** `event.id`. We *have* those fields (`Event_Name`, `Event_DateTime`, `Venue`). But StubHub fuzzy-matches on these and may mis-map — so gate it behind a separate `STUBHUB_ALLOW_EVENT_MAPPING` env, off by default, and only for new events. Do **not** rely on it for the bulk migration.
- **Backfill is the real fix:** extend `scripts/data/stubhub-id-remap.csv` to cover the gap, or capture StubHub's `eventMappingId` GUID at import time (`ImportEventsClient.tsx:563`) going forward and resolve once via `GET /events/{eventMappingId}` → numeric `eventId` cached back into `mapping_id`. Track this as a parallel data workstream (§8).

**Before cutover, run coverage queries** against the live `events` collection to quantify the gap; the count of active events failing `^[0-9]{9}$` is the number that will be skipped on day one.

---

## 6. Field-mapping decisions (final `CsvRow` → API)

The mapper lives in `lib/stubhub/mapRow.ts` and produces **two** bodies: a `create` body and a `patch` body (because price/barcode aren't in create).

### 6.1 Create body (`InventoryCreateRequest`)

| CsvRow field | StubHub field | Decision |
|---|---|---|
| `inventory_id` | `externalId` (string) | Reconciliation key. `externalId = String(inventory_id)`. |
| `event_id` (=`mapping_id`) | `event: { id }` | Via resolver §5. Skip row if unresolved. |
| `quantity` | `ticketCount` (int32) | Direct. |
| `section` | `seating.section` | Direct string; group-level only. |
| `row` | `seating.row` | Direct, **except** `GA\d+`/`SRO` synthetics — see zone below. |
| `seats` | — | **Not in create body** (no per-ticket array). Set later via PATCH if ever needed. |
| `split_type` + `custom_split` | `splitType` (`ApiSplitType`) | Enum conversion below. |
| `stock_type` + `instant_transfer` + `files_available` | `deliveryType` (`ApiDeliveryType`) | **Collapse 3 signals → 1 enum** below. |
| `in_hand_date` | `inHandAt` (date-time) | Must run after async venue-TZ geocoding (`resolveVenueTimezonesBulk`); same logic as CSV (`csvActions.tsx:749-762`). |
| `hide_seats` | `hideSeats` (bool) | `"Y"/"N"` → bool. |
| `zone` | `zoneFill` (bool) + blank `seating.row`/seats | `"Y"` → zone listing. |
| `cost`/`taxed_cost` | `unitCost` / `faceValueCost` / (taxed → **drop**) | `unitCost = cost`; `faceValueCost = face_price ?? cost`; `taxed_cost` has no field — keep local only. |
| `tags` | `tags[]` (`TagRequest`) | See routing-token note below. |
| `internal_notes` (`-tnow -tmplus -geek`) | **NOT `internalNotes`** | These are Automatiq routing tokens. Do **not** send. Optionally interpret `-geek` etc. to decide `broadcastStatuses`/marketplaces, but default: drop. |
| `public_notes` (+SRO) | `listingNotes[]` `{ note }` | Direct; keep SRO suffix. |
| `currencyCode` | `currencyCode` | Hardcode `"USD"`. |
| `shown_quantity` | `maxDisplayQuantity` | Map if non-zero, else omit. Likely unsupported — confirm. |
| `passthrough` | — | Drop (Sync-specific, collides with `externalId`). |

### 6.2 Patch body (price + broadcast, after create)

`PATCH /inventory/{id}` with:
- `prices[]`: `{ listPrice: <adjustedListPrice>, marketplace: 'StubHub' }`. **Decision: send `listPrice` (the ask), not `proceeds`**. If StubHub requires net proceeds, add a fee-conversion step in `mapRow.ts` as the final transform — flag for ops confirmation.
- `broadcastStatuses[]` / `autoBroadcast`: list on StubHub (and optionally other `ApiMarketplace` values).

### 6.3 The price-markup application point (critical)

The marked-up `list_price` is **computed in `processBatch` (`csvActions.tsx:726-736`), not stored**. The formula
`adjustedListPrice = rawListPrice * (1 + (defaultPct + adj)/100) / (1 + defaultPct/100)`
already runs during `generateInventoryCsv`, so by the time rows reach `pushInventory(rows)` the `CsvRow.list_price` is **final**. **Do not re-apply markup in the provider** — map `CsvRow.list_price` straight into `prices[].listPrice`. (The env-based `applyPriceAdjustment`/`PRICE_INCREASE_PERCENTAGE` path is dead for export — leave it dead; do not resurrect it for the API.)

### 6.4 Enum conversions

**Split** (`split_type` → `ApiSplitType: Any | None | AvoidOne | AvoidOneAndThree | Pairs`):

| Our value | StubHub `splitType` | `customSplit` |
|---|---|---|
| `NEVERLEAVEONE` | `AvoidOne` | omit |
| `CUSTOM` | **no exact match** → closest is `Pairs` for `[2,4,6]`-style, else `Any` | StubHub `ApiSplitType` has **no arbitrary custom-int-array** — flag as open question. |
| `DEFAULT`/`ANY` (unused) | `Any` | omit |

⚠️ This is a real mismatch: our `CUSTOM` + `custom_split` integer list has **no clean `ApiSplitType` equivalent** (the enum is a fixed set, not an int array). Confirm with StubHub how custom split quantities are expressed; until then, map `CUSTOM` → `AvoidOne` or `Pairs` conservatively and log when an exact custom list can't be honored.

**Delivery** (`stock_type` + `instant_transfer` + `files_available` → `ApiDeliveryType: InApp | PDF | Paper | MemberCard | Wallet | Custom`):

| Our `stock_type` | `deliveryType` |
|---|---|
| `ELECTRONIC` / `MOBILE_TRANSFER` | `InApp` (or `Wallet`) |
| `MOBILE_SCREENCAP` | `Custom` (no clean match) |
| `HARD` | `Paper` |
| `FLASH` | `Wallet` / `Custom` |
| `PAPERLESS` / `PAPERLESS_CARD` | `MemberCard` |

The three CSV signals collapse into this one enum. `files_available` is hardcoded `"N"` and `in_hand` hardcoded `"N"`, so they don't influence the value today — only `stock_type` matters in practice. Centralize the table in `mapRow.ts` and verify each value against the live schema before prod.

---

## 7. Migration plan / phases

**Guiding principle:** CSV stays *fully functional and selectable* throughout — we only ever flip the `inventorySyncProvider` flag/env. Nothing is deleted.

**Phase 0 — Seam refactor (no behavior change).** Land the `InventorySyncProvider` interface, `CsvSyncProvider` wrapping today's code, `getProvider` defaulting to `'csv'`, and `pushInventoryToSyncService(rows)`. Export `CsvRow`. Add `inventory.stubhubListingId/stubhubSyncedAt/stubhubSyncHash` to `seatModel.js` and `inventorySyncProvider` to `featureFlagModel.js`. **Acceptance:** prod runs identically on CSV; zero StubHub code in the hot path. This is the first PR (§9).

**Phase 1 — StubHub client + sandbox validation (shadow).** Build `lib/stubhub/`. Wire it to **sandbox** (`Account-Id: 6521964d-2692-4070-a33e-f39df2d8f52e`, sandbox bearer token, `STUBHUB_BASE_URL` sandbox host). Run `StubHubApiProvider` in **shadow mode**: the flag stays `'csv'` so CSV is live, while a new offline script (or `dryRun:true` provider mode) takes the same `CsvRow[]`, runs `mapRow` + resolver + diff, and **logs intended POST/PATCH/DELETE without executing**. Validate: event-id coverage, enum mappings, price equality vs CSV, and the sandbox 10%-fee skew (expect inflated prices back; assert our *sent* `listPrice` matches CSV, ignore the inflated echo).

**Phase 2 — Live sandbox writes.** Flip a subset (e.g. one test event or `STUBHUB_EVENT_ALLOWLIST`) to actually `POST`/`PATCH`/`DELETE` against sandbox. Verify reconciliation: create → capture `id` → persist `stubhubListingId` → re-run cycle → confirm NO-OP (hash match) → change a price → confirm single PATCH → remove row → confirm DELETE. Exercise the circuit breaker (force a token failure, confirm it aborts instead of mass-deleting).

**Phase 3 — Production cutover (April 13 migration date).**
1. Pre-flight: run coverage queries; ensure remap CSV applied; record the skip count.
2. Point `STUBHUB_*` env at production creds/host.
3. Flip `inventorySyncProvider` flag → `'stubhub'` (or env override) during a low-traffic window. The cron scheduler picks it up on its next interval (`csv-scheduler/route.ts`).
4. Watch `SchedulerSettings.lastUploadStatus`, `PushResult.skipped`, and StubHub `/inventory/export` for the first few cycles.
5. **Revert path:** set `INVENTORY_SYNC_PROVIDER=csv` in PM2 + restart, or flip the flag — instant return to Automatiq. Because we never stopped writing the same DB and never removed CSV code, revert is risk-free.

**Phase 4 — CSV dormant.** Once StubHub is stable for N days, leave CSV code in place but unselected. Do **not** delete `lib/syncService.js`, `generateCsvString`, Danger Zone, or the Automatiq env — they are the documented fallback. Revisit removal only quarters later.

---

## 8. Risks & open questions

1. **Event-mapping coverage (highest risk).** Only ~2,035 of 2,038 remap rows carry a 9-digit id; any event imported after the remap CSV, or holding a 7-digit Vivid id, **cannot be listed** and will be skipped. *Mitigation:* run coverage queries pre-cutover, skip+log, extend the remap CSV, and start capturing StubHub `eventMappingId` GUIDs at import. The circuit breaker (§4.2) prevents a resolution-wide failure from mass-deleting the book.
2. **No bulk create.** A cycle is `O(changed)` sequential writes, not one upload. *Mitigation:* mandatory diff (§4) + `stubhubSyncHash` so steady state emits only deltas; concurrency pool.
3. **Rate limits unknown.** Spec declares no limits/headers. *Mitigation:* adaptive 429 backoff + concurrency throttle; **get real RPS/quota from StubHub before prod.**
4. **Sandbox 10% fee skew (not in swagger).** Prices echoed back are inflated ~10% and account is non-active. *Mitigation:* validate on *sent* values, not echoed; treat as operational note; confirm with StubHub contact.
5. **No event search API.** Can't look up an event by name/date. *Mitigation:* rely on stored numeric id; `eventMapping` only as gated enrichment.
6. **Create has no price field.** Create → unpriced listing → must PATCH price/broadcast. *Mitigation:* two-call create unit, persist link only after both succeed; ask StubHub if create-with-price exists.
7. **Custom split has no `ApiSplitType` equivalent.** Our `CUSTOM` + int list doesn't fit the fixed enum. *Open question for StubHub.*
8. **Barcode / in-hand timing.** Barcodes are a post-create PATCH keyed by `ticketId`; in-hand date depends on async TZ geocoding. *Mitigation:* run TZ resolution before mapping (as CSV does); defer barcode PATCH (scraper rarely populates barcodes).
9. **`externalId` not server-searchable.** *Mitigation:* persist `stubhubListingId` locally; `/inventory/export` + `externalId` for recovery; optional migration tag for bulk correlation.
10. **Danger Zone has no StubHub analog.** Blank-wipe is CSV-only. *Mitigation:* hard-fail in StubHub mode with a clear message.

---

## 9. First-PR checklist (smallest shippable slice)

**Goal: land the seam with zero behavior change, prod still 100% on CSV.** No StubHub network code yet.

- [ ] `export` the `CsvRow` interface from `actions/csvActions.tsx:42`.
- [ ] New `lib/sync/InventorySyncProvider.ts` — the interface + `PushResult`/`DeleteResult` types (§2.1).
- [ ] New `lib/sync/CsvSyncProvider.ts` — wraps existing `SyncService` + `generateCsvString`; preserves 180s race, 5-retry/2s/30s upload config, blank-guard (§2.4).
- [ ] New `lib/sync/getProvider.ts` — env > flag > `'csv'` default (§2.2).
- [ ] `models/featureFlagModel.js`: add `inventorySyncProvider: { type:String, enum:['csv','stubhub'], default:'csv' }`.
- [ ] `models/seatModel.js`: add `inventory.stubhubListingId` (indexed), `stubhubSyncedAt`, `stubhubSyncHash` (§4.1) — additive, nullable, no migration needed.
- [ ] `actions/csvActions.tsx`: add `pushInventoryToSyncService(rows, opts)` that calls the provider and keeps writing `SchedulerSettings.lastUpload*` (§2.3). Have `generateInventoryCsv` also return `rows: CsvRow[]`.
- [ ] Rewire `app/api/csv-scheduler/route.ts:174` and `app/api/export-csv/route.ts:40` to call `pushInventoryToSyncService(result.rows)` instead of `uploadCsvToSyncService(result.csv)`; keep 0-record refusals (`:212-224`, `:29`).
- [ ] Refactor `deleteInventoryBatchFromSync` (`csvActions.tsx:1231`) body to delegate to `provider.deleteInventory` (§2.3, Seam 2). Leave all four call-sites untouched.
- [ ] Add a `StubHubApiProvider` **stub** that throws `"not implemented"` so `getProvider` compiles — selectable only when someone explicitly sets the flag (defaults keep it dormant).
- [ ] Leave `danger-upload-csv` and `generate-csv` routes **unchanged**.
- [ ] Smoke test: with default flag, manual export + scheduled cron + per-event delete all behave identically to today (CSV → Automatiq).

**Out of scope for PR #1** (follow-ups): `lib/stubhub/client.ts`, `mapRow.ts`, `eventResolver.ts`, `reconcile.ts`, sandbox wiring. Those land in Phase 1.

---

**Key files referenced:** `actions/csvActions.tsx` (`:42` `CsvRow`, `:367`/`:932` generators, `:1142` push, `:1231` delete, `:726-736` markup, `:901` `generateCsvString`), `lib/syncService.js` (`:168` upload, `:196` delete), `actions/seatActions.ts` (`:260/276/315/328` delete sites), `app/api/csv-scheduler/route.ts`, `app/api/export-csv/route.ts`, `app/api/danger-upload-csv/route.ts`, `app/api/auto-delete/route.ts`, `models/seatModel.js` (`:145` `inventoryId`), `models/eventModel.js` (`:5` `mapping_id`), `models/featureFlagModel.js`, `lib/featureFlags.ts`, `scripts/replaceStubhubMappingIds.js`, `scripts/data/stubhub-id-remap.csv`.
