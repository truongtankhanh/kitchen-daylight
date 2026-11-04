# Administrative units seed (`provinces`, `wards`)

> **Reuse terms unverified.** No license statement was found on the source service (see "Source" below). Check the reuse terms with the owner before any public redistribution of `provinces.json` and `wards.json`.

**Package `@kd/seed-data` (private).** These are copies of `data/admin-units` from the design workspace (P3-T3). Nothing here touches a database: the loader that writes these rows to PostgreSQL is the `seed reference` command of `tools/seed`, built in a later slice.

| Script                                  | What it does                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm --filter @kd/seed-data verify`    | Offline check of the committed JSON (no network)                                                                   |
| `pnpm --filter @kd/seed-data run fetch` | Rebuilds the JSON from the NSO web service (network). Needs `run`, because `pnpm fetch` is a built-in pnpm command |
| `pnpm --filter @kd/seed-data lint`      | ESLint on the two scripts                                                                                          |

Changes from the copy:

- `fetch.mjs` and `verify.mjs` are formatted with Prettier. One unused variable was dropped from `fetch.mjs`; its output is unchanged.
- The JSON files are byte-identical to the source and excluded from Prettier, because `fetch.mjs` writes them with a one-space indent.
- The commands below run from this folder. Links to `docs/` below point into the design workspace, not into this repository.

Reference data for the `provinces` and `wards` tables of [data-model.md](../../docs/data-model.md) (v3). Part of the review in [docs/data-sources.md](../../docs/data-sources.md).

| File             | What it is                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `provinces.json` | 34 provincial units, one row each: `code`, `names {vi, vi_full}`, `type` (`CITY` \| `PROVINCE`), `region`                 |
| `wards.json`     | 3,321 commune-level units: `code`, `province_code`, `names {vi, vi_full}`, `type` (`WARD` \| `COMMUNE` \| `SPECIAL_ZONE`) |
| `fetch.mjs`      | Rebuilds both files from the official web service. No dependencies, Node 18+                                              |
| `verify.mjs`     | Checks the invariants the tables rely on (counts, code formats, parents, clean names)                                     |

```
node fetch.mjs                     # state as of today
node fetch.mjs --asof 01/07/2025   # state as of a date (dd/MM/yyyy); add --out <dir> to keep the committed files untouched
node verify.mjs
```

## Source

The official web service of the National Statistics Office (formerly the General Statistics Office): `https://danhmuchanhchinh.nso.gov.vn/DMDVHC.asmx` (operations `DanhMucTinh`, `DanhMucPhuongXa`; SOAP, no key). It is the service the NSO publishes its administrative-unit list through, and the one the community datasets I found name as their source. I did not find a license statement on the service, so check reuse terms with the owner before public redistribution of the files. The Vietnamese statute behind the structure is Decision 19/2025/QĐ-TTg (codes and the 34 + 3,321 list); later resolutions changed some units (below).

Retrieved 2026-10-21 (`_meta` in each file holds the date and counts). Result: 34 provinces (9 of type `CITY`, 25 `PROVINCE`), 3,321 wards: 709 `WARD`, 2,599 `COMMUNE`, 13 `SPECIAL_ZONE`. HCMC (code `79`) has 168 units: 113 wards, 54 communes, 1 special zone (Côn Đảo), which matches the figures in the press and the legal sources I found.

## Checks done

| Check                                                                                                             | Result                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Counts                                                                                                            | 34 provinces, 3,321 wards; `verify.mjs` passes                                                                                                                                                                                                                                                      |
| Against a second dataset (ThangLeQuoc/vietnamese-provinces-database v5.2.0, MIT, built from the same NSO service) | Province codes identical; ward codes identical (3,321 of 3,321). Names equal after normalising whitespace and tone-mark placement, except 7 communes whose apostrophe differs (`H'Leo` vs `H’Leo`). The two are not independent (same origin), so this checks my parsing, not the Government's data |
| Against the state on 2025-07-01 (same service, `--asof`)                                                          | Same 34 and 3,321 codes. **3 provinces changed type PROVINCE → CITY** (Quảng Ninh 22, Bắc Ninh 24, Đồng Nai 75) and **22 communes changed Xã → Phường** with the same code                                                                                                                          |
| Official spelling                                                                                                 | The service mixes two tone-mark conventions (81 names like "Hoà", 181 like "Hòa") and one name had a line break (`Phường \nHoàn Kiếm`). `fetch.mjs` collapses whitespace and applies NFC and keeps the official spelling otherwise                                                                  |

## Mapping to the schema

| Fixture field                    | Column                         | Note                                                                                                                                                     |
| -------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`                           | `provinces.code`, `wards.code` | Official codes, 2 and 5 digits, as text                                                                                                                  |
| `names.vi`                       | `names->>'vi'`                 | Short name without the type prefix: "Hồ Chí Minh", "Bến Thành". The app builds "TP. Hồ Chí Minh" / "P. Bến Thành" from `type`                            |
| `names.vi_full`                  | `names->>'vi_full'`            | Official full name ("Phường Bến Thành"); an extra key, the schema only requires `vi`                                                                     |
| `type`                           | `provinces.type`, `wards.type` | `Thành phố Trung ương` → `CITY`; `Phường` → `WARD`, `Xã` → `COMMUNE`, `Đặc khu` → `SPECIAL_ZONE`                                                         |
| `region`                         | none                           | The service returns it (`Vung`) but the model has no column; ignore or add later                                                                         |
| `effective_from`, `effective_to` | not in the fixture             | See finding 1 in docs/data-sources.md: the fixture cannot carry history while `code` is the primary key. Loader should set `effective_from = 2025-07-01` |

## Not included

- **Ward boundaries** (needed to derive a ward from GPS). Candidate: the GIS add-on of the dataset above (MIT repository; its boundaries come from `sapnhap.bando.com.vn`, whose license I did not verify). The GeoJSON is 606 MB unpacked (48 MB zipped, 41.8 MB as a PostGIS dump), so it is not committed.
- English names and postal codes (also in that dataset; no column for them).
- Old (pre-July 2025) districts and wards: VER.01 addresses still use them. Conversion tables exist as community datasets; not evaluated.
