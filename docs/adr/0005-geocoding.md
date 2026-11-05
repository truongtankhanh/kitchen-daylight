# ADR-0005: Geocoding and map handling

- **Status:** **Reduced by [ADR-0009](0009-owner-business-pivot.md) (2026-10-27):** there is no bulk geocoding of 290 third-party addresses any more. Branch pins are placed by hand (a handful of rows) and the geocoder, if kept, only proposes coordinates for a customer's delivery address; the coverage spike becomes small and optional. The MapLibre and tile-source decisions still stand (the map shows branches and a delivery address picker). Original status: Proposed. Depends on the coverage spike described below. **Revised 2026-10-21:** the owner chose free OpenStreetMap-based maps (see "Revision 2026-10-21"); geocoding is still undecided.
- **Naming note (2026-10-28, data model v5):** below, read `places.location` as `branches.location` (placed by hand) and `customer_addresses.location` (the customer drops a pin; required). `places.location_source` does not exist in v5, and the one-time backfill of about 290 places under Consequences is dropped.
- **Date:** 2026-10-21
- **Depends on:** [ADR-0001](0001-tech-stack.md), [ADR-0004](0004-aws-hosting.md), [data-model.md](../data-model.md)

## Context

VER.01 stores no coordinates. The Android app geocoded each address on the device with the platform `Geocoder` at runtime, on the UI thread, for every "nearby" and map action. VER.02 stores `places.location` (PostGIS) so that nearby queries run in the database. That means coordinates will be **persisted**, which constrains the provider choice.

Provider terms found while preparing this ADR:

- **Google Geocoding API:** the Google Maps Platform service-specific terms allow caching of latitude/longitude from the Geocoding API for **up to 30 consecutive calendar days**, not permanently. Source: the archived 2025-05-01 terms, listed in References. I did not read the live terms or the Geocoding API Policies, so re-check them before relying on this. On this reading, Google geocoding cannot be the source of coordinates stored long-term.
- **Amazon Location Service:** the geocoding request has an `IntendedUse` setting. `SingleUse` (the default) means results are not stored; `Storage` means results may be cached or stored in a database. Providers are Esri, HERE and Grab. Grab provides data for Southeast Asia only. **Per-provider coverage for Vietnam and address match quality were not verified.**

## Decision

1. **Geocode on the server, only when an admin saves an address.** The mobile app never geocodes; it reads stored coordinates.
2. **Provider: Amazon Location Service with `IntendedUse = Storage`**, called from the API through its IAM task role (no API key in code or config). This fits ADR-0004 and the storage requirement.
3. **Mandatory spike before implementation:** geocode all ~290 distinct addresses from the VER.01 seed with each candidate provider that AWS offers for Vietnam, measure the match rate, and manually spot-check a sample on a map. Pick the provider from the results.
4. **Fallback if coverage is poor:** Mapbox permanent geocoding (its terms need to be verified for storage), or manual pin placement by an admin for unmatched places.
5. **The admin always confirms the location.** The admin form shows a map with a draggable pin; the saved coordinate is what the admin confirmed. `places.location_source` records `GEOCODED` or `MANUAL`.
6. **Directions:** the app opens the device's maps app by deep link with the stored coordinates instead of building routing. VER.01 only drew a marker (its in-app navigation intent was commented out), so this matches the actual behavior.
7. ~~**Map display on mobile** with `react-native-maps` (Apple Maps on iOS, Google Maps on Android).~~ **Superseded by the revision below.**

## Revision 2026-10-21 (owner decision: free OpenStreetMap-based maps)

The owner asked for a free map. They first wrote "One Map"; OneMap is the Singapore government service and covers Singapore only (secondary sources, not the official terms), so the owner confirmed **OpenStreetMap (OSM) with MapLibre**.

1. **Map display on both clients uses MapLibre** (MapLibre GL JS in the Angular admin; a MapLibre binding for React Native on mobile, whose current API and Expo compatibility I did not verify) with **vector tiles built from OSM data**. This replaces `react-native-maps` and removes the need for a Google Maps key.
2. **Do not use the public OSM tile server (`tile.openstreetmap.org`) in released apps.** Its policy forbids heavy use, names distributing an app that loads tiles from it as needing prior permission, and allows blocking without notice. The tile URL must be configuration, never hard-coded, so the source can change without an app release. Choosing the tile source is an open item: self-host tiles cut from a Vietnam OSM extract (for example a single-file tile archive on S3 behind CloudFront, which fits ADR-0004), or a third-party provider with a free tier. Neither was evaluated; costs, limits and licenses are unknown.
3. **Attribution is mandatory.** OSM data is under ODbL: every map shows "© OpenStreetMap contributors" (the frames do).
4. **Geocoding is a separate question and stays open.** The public Nominatim service is a candidate for the spike, within its policy limits: at most 1 request per second, an identifying User-Agent, no autocomplete, results cached, and bulk jobs discouraged. Geocoding only when an admin presses "Tìm tọa độ" fits those limits; the one-time backfill of about 290 addresses must run as one single-threaded job at or below 1 request per second. Match quality for Vietnamese addresses in OSM is unverified, so the spike still compares it with Amazon Location (`IntendedUse = Storage`). Manual pin placement stays the guaranteed fallback.
5. **Directions** are unchanged: the app opens the device's maps app with the stored coordinates.

## Alternatives considered

- **Google Geocoding API with a 30-day refresh job:** keeps data fresh in terms of the license, but turns a one-time, admin-time action into a recurring paid batch and still exposes the project to terms drift. Rejected for the persistent store.
- **OpenStreetMap Nominatim public instance:** the public service is not intended for bulk use, and Vietnamese address coverage is unverified. Self-hosting is out of scope. *Reconsidered 2026-10-21 as a spike candidate for admin-triggered geocoding only (see the revision).*
- **Geocode on the device as in VER.01:** unreliable, slow, repeated for every user, and cannot back a database `ORDER BY` distance query. Rejected.

## Consequences

- One-time backfill of about 290 places runs as a migration step and is reviewed on a map before data is trusted. It is the second part of the migration plan.
- Geocoding becomes an admin-API dependency with its own failure mode. The admin form must work when geocoding fails (manual pin).
- The Location Service data provider affects both cost and result quality, so the provider is chosen by the spike, not up front.
- Geocoding sits behind a `GeocodePort` ([ADR-0004](0004-aws-hosting.md)). `dev` binds a deterministic fixture adapter; `demo` and `prod` bind Amazon Location. The API must refuse to start in `prod` with the fixture adapter.

## Open items

1. Spike result: provider, match rate, count of manual corrections.
2. ~~Map display library~~ decided: MapLibre with OSM-based tiles. Still open: the tile source (self-hosted or provider) and its cost.
3. Re-check the live Google and chosen-provider terms at implementation time.

## References

- Google Maps Platform service-specific terms, archived 2025-05-01: <https://cloud.google.com/archive/maps-platform/terms/maps-service-terms-20250501>
- Amazon Location Service, Geocode developer guide: <https://docs.aws.amazon.com/location/latest/developerguide/geocode.html>
- Amazon Location Service, data source configuration (`IntendedUse`, providers): <https://docs.aws.amazon.com/location/previous/APIReference/API_DataSourceConfiguration.html>
- OpenStreetMap tile usage policy and community discussion: <https://wiki.openstreetmap.org/wiki/Tile_usage_policy>, <https://operations.osmfoundation.org/policies/vector/>
- Nominatim usage policy: <https://operations.osmfoundation.org/policies/nominatim/>
- Singapore OneMap (coverage, secondary sources): <https://sla.gov.sg/geoworks/sla-products/onemap>
