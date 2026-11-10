# 0009. Media and storage

Status: **proposed** (A6-T1, 2026-11-10). Fixes how the API implements the "Uploads" row of [ADR-0004](../adr/0004-aws-hosting.md) section 3 and the `media` module of [scaffold-plan](../scaffold-plan.md) section 4: the image library, the content checks, the variants and placeholders, the upload rules and limits, object keys and public URLs, the S3 client and the storage rows of the production guard. Cited as "decision 0009"; the project record [ADR-0009](../adr/0009-owner-business-pivot.md) is a different series. **Every number in this record is a proposal for the owner** (section 11).

## Contradictions and tightenings

Each row names a document that this record contradicts (**C**) or makes stricter (**T**). The API track does not edit those documents: the task that builds a row logs it in [api-divergences.md](api-divergences.md) ([decision 0007](0007-api-platform-libraries-and-rules.md), section 13).

| # | Kind | Document | It says | This record says |
|---|---|---|---|---|
| 1 | C | [data-model.md](../data-model.md), table `media` | No timestamp column; `sha256` "prevents duplicate uploads" without a stated constraint | `media.created_at timestamptz not null default now()` and a unique `sha256` are added by A6-T3 (section 8). Logged as a divergence by A6-T3 |
| 2 | C | data-model.md, "Personal data lifecycle", row "Unreferenced `media`" | "Delete 7 days after the last reference is removed" | No column records when the last reference was removed. Rule: a row with no reference now **and** `created_at` older than 7 days is deleted (section 8). An image unlinked after its seventh day goes at the next nightly run |
| 3 | T | data-model.md `menu_items`, `branch_media`, finding 14; [api-outline.md](../api-outline.md) `/admin/menu-items` and `/admin/branches` rows, open item 9 | Photo limits 8 per item and 12 per branch, "fixed or an `app_settings` value" open (B15, C32, R4) | Fixed constants (section 5). A setting later is a non-breaking change |
| 4 | T | api-outline.md, `POST /admin/uploads/images` | "validated, resized, `blurhash`; as in v2" | Accepted types, variants, metadata stripping, pixel limit, response shape and status codes fixed in sections 2 to 7 |
| 5 | T | api-outline.md, same row; data-model.md `media` | Logo rules (2 MB, at least 256 px) and banner rules (2:1, at least 600 x 300) listed on the upload endpoint | The upload applies the photo rules only; logo and banner rules are checked from the `media` row when the image is **assigned** to `brand.logo` or to a banner (section 5). The data-model sentence "The API validates uploads from `content_type`, `bytes`, `width` and `height`" is the basis |
| 6 | T | data-model.md `media` | `content_type`, `bytes` without a stated meaning | `content_type` is the detected type of the uploaded file, `bytes` its size; the stored variants are always `image/webp` (section 8) |

## Context

- ADR-0004: admin uploads go through the API (multipart, size and type validated), are resized with `sharp`, written to S3 and served through CloudFront; no Lambda, no presigned flow. `dev` uses an S3-compatible emulator. Production runs on EC2 `t4g.small` (ARM64, 2 GB shared with PostgreSQL and Caddy).
- api-outline: images are returned as "Full CDN URLs plus `blurhash` and `alt`; never raw keys"; `413 TOO_LARGE` over 10 MB, `415 UNSUPPORTED_TYPE` for other types, the same content returns `200` with the existing row and `duplicate: true` (B16); field codes `TOO_MANY` (item, 8), `LIMIT_REACHED` (branch, 12), `TOO_LONG` (`alt`, 200); `GET /meta/config` returns `cdnBaseUrl`.
- data-model: `media` (`id`, `storage_key` unique, `content_type`, `width`, `height`, `bytes`, `sha256`, `blurhash`, `alt_text` at most 200 by `CHECK`, `uploaded_by`), `menu_item_media` and `branch_media` (position 0 is the cover). `alt_text` belongs to the `media` row (B18, kept).
- Decision 0005: the storage variables (section 2), adapter kinds and the guard (section 5), the image contract (section 9: Debian slim Node 26.13.0, `linux/amd64` and `linux/arm64`, non-root). `apps/api/Dockerfile` installs with `pnpm fetch`, `pnpm install --offline --frozen-lockfile` and `pnpm --filter @kd/api deploy --prod`.
- Docker repository: `api-contract.md` passes `STORAGE_S3_ENDPOINT=http://s3:8333`, `STORAGE_S3_REGION=us-east-1`, `STORAGE_S3_FORCE_PATH_STYLE=true`, the emulator keys and the buckets `kd-dev-media`, `kd-dev-private` ("assumed, confirm with the monorepo"). `versions.env`: SeaweedFS 4.51 run as `weed mini`; fallback Garage v2.5.0.
- `apps/api/src/config/config.schema.ts` (read 2026-11-10) has **no** CDN or public media URL variable: A4-T3 added only `APP_STORE_URL_IOS` and `APP_STORE_URL_ANDROID`.

## Options

| Concern | Option kept | Options rejected | Why |
|---|---|---|---|
| Image processing | `sharp` 0.35.5 | `jimp` 1.6.1 | `jimp` is pure JavaScript; its page lists PNG, JPEG, BMP, GIF and TIFF and says nothing of WebP or EXIF orientation [S7]. `sharp` has prebuilt binaries for the three platforms, no install script, a pixel limit, auto-orientation, metadata stripped by default and WebP output [S1] to [S4] |
| Real type of the file | hand-written magic-byte check (JPEG, PNG, WebP) **and** agreement with `sharp` metadata | `file-type` 22.3.0; `sharp` metadata alone | Three signatures need about twenty lines with a unit test; `file-type` adds four dependencies for formats that are refused anyway [S9]. `sharp` alone would decode any format libvips knows (GIF, TIFF, SVG, HEIF where built) before the type is refused |
| Multipart | `FileInterceptor` of `@nestjs/platform-express` (multer 2.5.0, memory storage) | streaming to disk; presigned upload | Admin-only, low volume, at most 10 MiB per request (ADR-0004); memory storage is the default [S5], [S6] |
| Placeholder | `blurhash` 2.0.5 | ThumbHash, dominant colour | api-outline and data-model name `blurhash`; MIT, no dependencies [S8] |
| S3 client | `@aws-sdk/client-s3` 3.1165.0 (v3) | a generic S3 library | Same SDK for the emulator and AWS (ADR-0004); instance-profile credentials through the default chain |
| Photo limits | fixed constants | `app_settings` keys | Nothing asks to change them at run time; a key can be added later without a contract change |
| Cleanup clock | `media.created_at` | a nullable `media.unreferenced_at` set on every unlink | One column with a default, no write on every unlink path (items, branches, settings, banners) |

## Evidence

Read on 2026-11-10. Registry data from read-only `npm view <pkg>@<version> version peerDependencies dependencies engines optionalDependencies license scripts --json` (source `https://registry.npmjs.org/<pkg>`). Nothing was installed.

| ID | Source |
|---|---|
| S1 | https://sharp.pixelplumbing.com/install: prebuilt binaries for "Linux x64 (glibc >= 2.28, musl >= 1.2.5, CPU with SSE4.2)", "Linux ARM64 (glibc >= 2.28, musl >= 1.2.5)", "macOS ARM64"; "Node-API v9 compatible runtime e.g. Node.js >= 20.9.0"; a compiler only when building from source; pnpm `supportedArchitectures` for cross-platform installs; on glibc Linux sharp limits thread concurrency because of the default allocator and recommends jemalloc for long-running processes. The page has no licensing section and says nothing about pnpm build-script approval |
| S2 | https://sharp.pixelplumbing.com/api-constructor: `limitInputPixels` default `268402689`, "Assumes image dimensions contained in the input metadata can be trusted"; `failOn` default `'warning'`, "Use the default 'warning' level with untrusted input", "Invalid metadata will always abort"; `unlimited` default `false` ("remove safety features that help prevent memory exhaustion (JPEG, PNG, SVG, HEIF)"); `sequentialRead` default `true`; `autoOrient` default `false`, "rotate/flip the image to match EXIF Orientation"; `animated` default `false`, `pages` default `1` |
| S3 | https://sharp.pixelplumbing.com/api-output: "By default all metadata will be removed, which includes EXIF-based orientation"; the default is to "strip all metadata, including the removal of any ICC profile" and convert to sRGB; `keepMetadata()`, `withMetadata()`, `keepExif()`, `keepIccProfile()` opt back in. `webp()`: `quality` default 80, `effort` default 4, `smartSubsample` default false, `lossless` default false, `alphaQuality` default 100 |
| S4 | Registry: `sharp` 0.35.5 (`latest`, published 2026-09-27; `next` is 0.35.5-rc.1), Apache-2.0, engines `node >=20.9.0`, dependencies `@img/colour`, `detect-libc`, `semver`; **no `install` or `postinstall` script** (scripts are `build`, `test`, `lint` and docs only); optional dependencies `@img/sharp-linux-x64`, `@img/sharp-linux-arm64`, `@img/sharp-darwin-arm64` 0.35.5 (Apache-2.0, `os`/`cpu` set, `libc: glibc` on Linux, no scripts), each depending on `@img/sharp-libvips-<platform>` 1.3.4, **license `LGPL-3.0-or-later`** |
| S5 | https://docs.nestjs.com/techniques/file-upload: `FileInterceptor(fieldName, options)` with `MulterOptions`; "By default, Multer uses its in-memory storage engine (`memoryStorage()`)", file on `file.buffer`; "Multer does not limit the size of uploaded files by default"; over a limit Nest answers "a `413 File too large` error (for `fileSize`)" or "`400 Bad Request` (for other limits, such as `files`)" and the handler is not called; "install the Multer type definitions: `npm i -D @types/multer`"; `FileTypeValidator` reads the magic number by default |
| S6 | https://github.com/expressjs/multer/blob/main/README.md: memory storage "can cause your application to run out of memory" with large files or many small ones; `limits` defaults `fileSize` Infinity, `files` Infinity, `fields` Infinity, `parts` Infinity, `fieldSize` 1 MB, `headerPairs` 2000; `LIMIT_FILE_SIZE`; "`file.originalname` is always client-supplied and should be treated as untrusted". Registry: `@nestjs/platform-express` 12.3.2 depends on `multer` 2.5.0 exactly (MIT, deps `busboy`, `type-is`, `append-field`); `@types/multer` 2.3.0 (`latest`, published 2026-09-28), MIT, depends on `@types/express` `*` (registry `latest` 5.0.6), `typeScriptVersion` 5.6 |
| S7 | https://jimp-dev.github.io/jimp/: "Supported image formats include PNG, JPEG, BMP, GIF, and TIFF"; "just JavaScript". Registry: `jimp` 1.6.1, MIT, 27 `@jimp/*` dependencies |
| S8 | https://github.com/woltapp/blurhash and its `TypeScript/README.md`: `encode(pixels: Uint8ClampedArray, width, height, componentX, componentY) => string`; "We usually go with 4 by 3", more X components for wide images; "you should scale your images down before running BlurHash on them"; "only 20-30 characters". Registry: `blurhash` 2.0.5 (`latest`, published 2023-02-17), MIT, no dependencies, no install script; `exports` has a `node` condition (CommonJS `dist/index.js`) and `import` (`dist/index.mjs`) |
| S9 | Registry: `file-type` 22.3.0 (published 2026-10-29), MIT, ESM, engines `node >=22`, dependencies `strtok3`, `token-types`, `uint8array-extras`, `@tokenizer/inflate` |
| S10 | https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html: `request_checksum_calculation` / `AWS_REQUEST_CHECKSUM_CALCULATION` and `response_checksum_validation` / `AWS_RESPONSE_CHECKSUM_VALIDATION`, default `WHEN_SUPPORTED`, values `WHEN_SUPPORTED` and `WHEN_REQUIRED`; SDK for JavaScript 3.x default algorithm CRC32 |
| S11 | https://github.com/aws/aws-sdk-js-v3/issues/6810: from 3.729.0 "clients default to enabling an additional checksum on all Put calls and enabling validation on Get calls"; reported failures with R2, B2, DigitalOcean Spaces and MinIO; workaround `requestChecksumCalculation: 'WHEN_REQUIRED'` and `responseChecksumValidation: 'WHEN_REQUIRED'`; one report that DELETE requests still sent a checksum header with both set |
| S12 | Registry: `@aws-sdk/client-s3` 3.1165.0 (`latest`, published **2026-11-09T20:14Z**), Apache-2.0, engines `node >=20.0.0`, no install script, eleven dependencies (`@aws-sdk/core`, `@aws-sdk/checksums`, `@aws-sdk/middleware-sdk-s3`, `@aws-sdk/credential-provider-node`, `@aws-sdk/signature-v4-multi-region`, `@smithy/core`, `@smithy/node-http-handler`, …) |
| S13 | https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API: PutObject, GetObject, HeadObject, DeleteObject, DeleteObjects and the object and bucket ACL calls supported; bucket policies "IAM-style"; **nothing on checksum headers, `aws-chunked` trailers, path style, anonymous read or `Cache-Control`**. `test/s3/SDK_COMPATIBILITY.md` covers SDK v2 only ("SeaweedFS currently returns MD5-based ETags"). A web search found commits adding checksum validation in `weed/s3api`, not tied to a release |

Not read (marked where used): the `S3ClientConfig` reference page (rendered empty), the SeaweedFS anonymous-read setup, the EC2 metadata hop limit for containers, CloudFront origin access control.

## 1. Image library

- **`sharp` 0.35.5**, pinned exactly in `apps/api` (only package that uses it).
- **Install under Node 26.13.0 and pnpm 12.16.1:** the platform binary comes from an optional dependency selected by `os`, `cpu` and `libc` (`@img/sharp-linux-x64`, `@img/sharp-linux-arm64`, `@img/sharp-darwin-arm64`, each with its `@img/sharp-libvips-*` 1.3.4) [S1], [S4]. No compiler. **No package of the set has an install script** [S4], so no `allowBuilds` entry is needed; the lockfile lists every platform package and each install keeps only its own. To confirm in A6-T3: `pnpm add` prints no ignored-build-script warning.
- **Decompression bombs:** `limitInputPixels: 50_000_000` (covers 48 and 50 MP phone sensors) instead of the default 268 MP [S2]; `unlimited` stays `false`; `failOn: 'warning'` (the documented setting for untrusted input) [S2]; the width and height from `sharp(buf).metadata()` are checked against the same limit before any resize, and a multipart body is already capped at 10 MiB (section 4). Over the pixel limit → `413 TOO_LARGE`.
- **Orientation and metadata:** `autoOrient: true` in the constructor [S2]; output keeps the default, which strips EXIF (GPS included), XMP, IPTC and ICC and converts to sRGB [S3]. `keepMetadata`, `withMetadata`, `keepExif` and `keepIccProfile` are never called; a unit test reads the output metadata of a JPEG fixture with an EXIF orientation and a GPS block and asserts that no EXIF is left and that the dimensions are rotated.
- **Animated input:** `pages` stays `1` [S2]: only the first frame is kept.
- **Process settings:** `sharp.cache(false)` (a long-running server, each input used once); at most **one image processed at a time** per instance (an in-process queue in the media service), because the instance has 2 GB for everything (ADR-0004). sharp already lowers its thread count on glibc [S1]; jemalloc is not added (revisit trigger).
- **Licence:** sharp is Apache-2.0; the bundled libvips is **LGPL-3.0-or-later**, a separate shared library in `node_modules/@img/sharp-libvips-*` [S4]. The public image (ADR-0010) redistributes it unmodified, with its licence files in `node_modules`. To confirm in A6-T3: those files are present in the `deploy --prod` output.

## 2. Accepted types and the content check

1. The request must be `multipart/form-data` with one file in the field `file`.
2. **Magic bytes**, a hand-written function in the media module with a unit spec: JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`; WebP `52 49 46 46` (`RIFF`) at 0 and `57 45 42 50` (`WEBP`) at 8. Anything else → `415 UNSUPPORTED_TYPE`. SVG, GIF, HEIC/HEIF, AVIF, TIFF and BMP are refused this way.
3. **Agreement:** `metadata().format` must be `jpeg`, `png` or `webp` and equal to the detected type; a mismatch, or a file sharp cannot read, → `415 UNSUPPORTED_TYPE`.
4. The client's `mimetype` and `originalname` are never trusted or stored [S6]; the file name is not kept anywhere.

## 3. Variants, master and placeholder

All variants are WebP, resized with `fit: 'inside'` and `withoutEnlargement: true` (a small source is not upscaled), `effort` 4 (default), alpha kept (logos).

| Name | Longest edge (px) | Quality | Use |
|---|---|---|---|
| `thumb` | 320 | 75 | list rows, chips, admin tables |
| `medium` | 800 | 80 | cards, mobile detail |
| `large` | 1600 | 82 | detail and full screen; the default `url` |
| `master` | 2560 | 90 | not returned to clients; the source for new variants later |

- **The original file is not kept.** The `master` is the re-encoded, oriented, metadata-free copy; a later variant set is derived from it. Re-cropping beyond 2560 px is lost on purpose.
- **Blurhash:** from the oriented image resized to fit inside 32 x 32, `ensureAlpha().raw()` → `Uint8ClampedArray` RGBA with its width and height [S8]; components 4 x 3 for landscape and square, 3 x 4 for portrait [S8]. Stored in `media.blurhash`.

## 4. Multipart handling and errors

- `FileInterceptor('file', { limits })` with the default memory storage [S5]; `limits`: `fileSize` 10 MiB (10,485,760 bytes; "10 MB" of the brief read as MiB, the lenient reading), `files` 1, `fields` 2, `parts` 3, `fieldSize` 1,024 bytes [S6].
- **`413 TOO_LARGE`:** multer's `LIMIT_FILE_SIZE` becomes Nest's 413 [S5]; the problem+json filter maps every 413 to `TOO_LARGE` (the only 413 code of the catalogue). The pixel limit of section 1 throws the same code.
- Other multer limit errors (extra file, extra field, wrong field name) are Nest 400s [S5] → `400 VALIDATION_FAILED`, `errors[] = [{ field: 'file', code: 'INVALID_FORMAT' }]`; no file → `REQUIRED`. To confirm in A6-T3 against the mapping of the existing filter in `common/errors/`.
- `multer` is not imported directly (it comes with `@nestjs/platform-express` 12.3.2 at 2.5.0, [S6]); `@types/multer` 2.3.0 is a dev dependency for `Express.Multer.File`. It pulls `@types/express` (`*`, `latest` 5.0.6) into the lockfile: to confirm in A6-T3 from the lockfile diff.
- Roles: `MANAGER` and `ADMIN` (menu, branches, logo); `STAFF` gets `403 FORBIDDEN`. Throttled by the `default` throttler (decision 0007 section 5).

## 5. Rules, as constants in one file

One file, `apps/api/src/modules/media/media.rules.ts`, exports every value below; nothing else repeats a number.

| Constant | Value | Checked when | Error |
|---|---|---|---|
| Photo size | 10 MiB | upload (multer) | `413 TOO_LARGE` |
| Pixel limit | 50,000,000 | upload | `413 TOO_LARGE` |
| Accepted types | JPEG, PNG, WebP | upload | `415 UNSUPPORTED_TYPE` |
| Photos per menu item | 8 | item save | `VALIDATION_FAILED { field: media, code: TOO_MANY }` |
| Photos per branch | 12 | branch photo tab save | `VALIDATION_FAILED { field: media, code: LIMIT_REACHED }` |
| `alt` length | 200 Unicode code points (the unit of the `CHECK`'s `char_length`) | wherever `alt` is written | `VALIDATION_FAILED { field: alt, code: TOO_LONG }` |
| Logo | at most 2 MiB (`media.bytes`), shorter side at least 256 px; type from the accepted list (SVG is already refused) | when the image is assigned to `brand.logo` | `VALIDATION_FAILED`, field `brand.logo`; field codes proposed in section 11 |
| Banner | ratio `width / height` from 1.96 to 2.04 (2:1 within 2 %), at least 600 x 300, at most 10 MiB | when the image is assigned to a banner (A15-T5) | as the logo |
| Unreferenced retention | 7 days from `media.created_at` | nightly job (A12-T2) | none |

- The 8 and 12 limits are **fixed** (B15, C32, R4 answered by this record). Moving them to `app_settings` later changes no contract.
- **Duplicates:** `sha256` (lowercase hex) of the **uploaded bytes**, computed before decoding. A match returns `200` with the existing row, `duplicate: true`, unchanged (its `alt` is not overwritten). A new row returns `201`, `duplicate: false`. Two concurrent uploads of the same bytes: the second insert hits the unique index, deletes the objects it wrote (best effort) and returns the winner as a duplicate.
- **Where `alt` is written:** an optional multipart text field `alt` on the upload (proposal, section 11). Since `alt_text` belongs to the `media` row (B18), an edit changes every place that uses the image.

## 6. Object keys, headers and URLs

- **Key layout:** `media/<yyyy>/<mm>/<media id>/<variant>.webp` (`yyyy`, `mm` in UTC from `created_at`; the id is the application-generated UUIDv7, needed before the insert). `media.storage_key` stores the prefix `media/<yyyy>/<mm>/<media id>` (unique, as in the data model). Keys come only from ids and the fixed variant names, never from the file name. A key is never overwritten: a new variant set gets new variant names.
- **On every `PutObject`:** `ContentType: image/webp`, `CacheControl: public, max-age=31536000, immutable`; **no `ACL`** parameter. Access is by bucket policy: in `demo` and `prod` the media bucket is private and read by CloudFront only (origin access control and Block Public Access: to confirm in the infrastructure task); in `dev` the emulator bucket allows anonymous read (Docker repository follow-up, SeaweedFS setup not read [S13]).
- **`MEDIA_PUBLIC_BASE_URL`** (new; no existing variable, see Context): absolute URL, no trailing slash, no query or fragment. A client URL is `<MEDIA_PUBLIC_BASE_URL>/<storage_key>/<variant>.webp`.
  - `dev`/`test`: optional; default `<STORAGE_S3_ENDPOINT>/<STORAGE_S3_BUCKET_MEDIA>` (path style), refused if neither it nor the endpoint is set. `http` or `https`.
  - `demo`/`prod`: required, `https` only: the CloudFront distribution URL (the bucket is the origin, so no bucket name in the path).
  - **Caveat:** the derived default is reachable only where the endpoint is: `http://s3:8333` (container) works for no browser, `localhost` for no phone. The Docker `apps` profile, and anyone testing the mobile app on a device, set the variable explicitly (Docker repository follow-up).
- **`cdnBaseUrl` of `GET /meta/config`** returns `MEDIA_PUBLIC_BASE_URL`. Clients still receive full URLs in every image object; `cdnBaseUrl` is informational.

## 7. The image object of every DTO

One DTO class, `MediaImageDto` in `modules/media/dto/media-image.dto.ts`, reused by every response that carries an image (menu items, branches, settings logo, banners):

```ts
{
  id: string;                    // media id; the admin sends it back as mediaId
  url: string;                   // = variants.large
  variants: { thumb: string; medium: string; large: string };
  blurhash: string;
  alt: string | null;
  width: number;                 // of the oriented master, for the aspect ratio
  height: number;
}
```

The upload response is `UploadedImageDto` = `MediaImageDto` plus `duplicate: boolean`. No key, bucket, `sha256`, byte count or uploader is returned.

## 8. Storage access and the `media` table

- **SDK:** `@aws-sdk/client-s3` 3.1165.0, one `S3Client` per process behind `StoragePort` (ADR-0004). Calls used: `PutObject`, `DeleteObject` (one key at a time: `DeleteObjects` needs a checksum even with `WHEN_REQUIRED` [S11], and the volume is small), `HeadObject` in tests.
- **Client options:** `region` from `STORAGE_S3_REGION`; when `STORAGE_S3_ENDPOINT` is set: `endpoint`, `forcePathStyle` from `STORAGE_S3_FORCE_PATH_STYLE`, static `credentials` from the two key variables, and `requestChecksumCalculation: 'WHEN_REQUIRED'` with `responseChecksumValidation: 'WHEN_REQUIRED'` [S10], [S11], because no SeaweedFS document states support of the SDK's default CRC32 trailers [S13]. Without an endpoint (AWS) the defaults (`WHEN_SUPPORTED`) stay. Option names: to confirm in A6-T2 from the package's type declarations (the reference page did not render). Whether SeaweedFS 4.51 accepts the defaults is **to confirm in A6-T2** (owner smoke run; if it does, the override may be dropped).
- **Credentials (decision 0005 section 2):** access keys only with the emulator; `demo` and `prod` use the instance profile through the SDK's default provider chain. Inside a container on EC2 this needs the instance metadata hop limit at 2 for IMDSv2: **not verified here**, to confirm in the infrastructure task.
- **Buckets:** `STORAGE_S3_BUCKET_MEDIA` holds only the media variants and is public through the CDN; `STORAGE_S3_BUCKET_PRIVATE` holds exports and anything else, is never served directly and never has a public policy (exports are downloaded through `/admin/exports/{id}/download`).
- **`media` table (A6-T3):** the data-model columns plus `created_at timestamptz not null default now()` and `UNIQUE (sha256)`; `sha256` is 64 lowercase hex characters by `CHECK`. Values: `content_type` the detected source type, `bytes` the uploaded size, `width`/`height` of the oriented master. Grants to `kd_app`: `SELECT, INSERT, UPDATE, DELETE` (`alt_text` edits, cleanup). The link tables reference `media` with `ON DELETE RESTRICT`, so a linked row can never be deleted.
- **Cleanup rule for A12-T2:** delete a `media` row whose `created_at` is older than 7 days and that no place references (`menu_item_media`, `branch_media`, `branches.cover_media_id`, the media ids in `app_settings` `brand.logo` and `payment` QR, banners when they exist; one list constant in the media module). The check and the delete run in one transaction; then the objects are deleted. Objects written by an upload that crashed before its insert have no row: the job may also list prefixes older than 7 days without a row (A12-T2 decides).
- **Upload order:** content check → `sha256` lookup → process → write the four objects → insert the row; a failed insert deletes the objects. An S3 failure is `500 INTERNAL_ERROR` with the cause in the log only.

## 9. Production guard rows for storage

Kind (decision 0005 section 5): `emulator` when `STORAGE_S3_ENDPOINT` is set, `real` otherwise. `STORAGE_ADAPTER` accepts `s3` only.

| `APP_ENV` | `emulator` | `real` | Other storage rules |
|---|---|---|---|
| `dev` | accepted | accepted | keys required with the endpoint, optional without |
| `test` | accepted | **refused** | keys required |
| `demo` | **refused** (proposal, section 11; tightens 0005, where only `prod` refuses) | accepted | `STORAGE_S3_ACCESS_KEY`, `STORAGE_S3_SECRET_KEY` set → refused; `STORAGE_ADAPTER`, `STORAGE_S3_REGION`, `MEDIA_PUBLIC_BASE_URL` (https) required |
| `prod` | **refused** | accepted | `STORAGE_S3_ENDPOINT` or either key set → refused; same required variables |

The guard test covers every cell.

## 10. Docker image

- The Dockerfile needs no change: Debian trixie slim has glibc above 2.28 [S1]; no `apt` package, no compiler. Each platform of the multi-platform build installs its own `@img/sharp-linux-<arch>`, and `pnpm deploy --prod` keeps optional dependencies.
- **To verify (owner, after A6-T3):** for `linux/amd64` and `linux/arm64`, the image's `/app/node_modules/@img/` holds the matching `sharp-linux-*` and `sharp-libvips-linux-*` 1.3.4, and `node -e "import('sharp').then(m => console.log(m.default.versions))"` prints the versions as user 1000; `hadolint apps/api/Dockerfile` unchanged.

## 11. Questions for the owner

Each has a proposal; "OK all" accepts them.

1. Variant sizes and qualities of section 3 (320/75, 800/80, 1600/82, master 2560/90), and not keeping the original.
2. Photo limits 8 and 12 as fixed constants.
3. Cleanup: unreferenced **and** `created_at` older than 7 days (an image unlinked after its seventh day goes at the next run), instead of "7 days after the last reference is removed".
4. Logo and banner rules checked when the image is assigned (field `brand.logo` or the banner's image field), not at upload; field codes `TOO_LARGE` (bytes) and `OUT_OF_RANGE` (dimensions or ratio), added to `FieldErrorCode` by the task that assigns. The alternative is a `purpose` field on the upload.
5. `alt` as an optional multipart field of the upload; where it is edited afterwards is left to the menu and branch tasks.
6. Pixel limit 50 MP answered with `413 TOO_LARGE`; 10 MB read as 10 MiB; first frame only of animated input.
7. Banner tolerance 2 %.
8. `demo` refuses the emulator (section 9).
9. `media.updated_at`: the data-model convention asks for it on mutable tables and `alt_text` is mutable, but this task names only `created_at`; add it in A6-T3 too?

## Choice

Sections 1 to 10, with the pins below.

## Reason

`sharp` is the library ADR-0004 names and the only candidate with WebP output, orientation, metadata stripping and a pixel limit, installed without a compiler or a build script on all three platforms. Keys from ids, immutable objects and full URLs keep the CDN simple and hide storage from clients. Fixed limits and one rules file keep the checks testable; every choice that changes data or contract is listed for the owner.

## Consequences

- **Pins** (each gets its 0001 row, read 2026-11-10, in the task that installs it):
  - **A6-T2** (storage port and S3 adapter): `@aws-sdk/client-s3` **3.1165.0** (dependency). Published 2026-11-09T20:14Z: pnpm's one-day `minimumReleaseAge` refuses it before about 2026-11-10T20:15Z; wait, no exclusion (as in 0001 for Expo).
  - **A6-T3** (media module and upload): `sharp` **0.35.5** and `blurhash` **2.0.5** (dependencies), `@types/multer` **2.3.0** (dev dependency). No `allowBuilds` change expected. `multer` 2.5.0 stays transitive through `@nestjs/platform-express` 12.3.2.
  - Not installed: `file-type`, `jimp`.
- **Decision 0005 section 2 table:** new row `MEDIA_PUBLIC_BASE_URL` (section 6); `STORAGE_ADAPTER` value set `s3`; the storage rows note the kind rule and the checksum options. Docker `api-contract.md` follow-ups: set `MEDIA_PUBLIC_BASE_URL` in the `apps` profile, anonymous read on `kd-dev-media`, confirm the storage rows marked "assumed".
- **Production guard:** the rows of section 9 and their test, in A6-T2.
- **A6-T3 divergences:** `media.created_at`, `UNIQUE (sha256)` and the cleanup rule (rows 1, 2), the assignment-time logo and banner checks (row 5), the fixed limits (row 3), in [api-divergences.md](api-divergences.md). To confirm there: whether `branches.cover_media_id` already has its foreign key.
- **A12-T2:** the cleanup rule of section 8. **Infrastructure task:** CloudFront origin access control, Block Public Access on both buckets, SSE, the IMDS hop limit, and the `MEDIA_PUBLIC_BASE_URL` SSM parameter.
- **Image verification** of section 10 by the owner.
- **Revisit triggers:** a second API instance or rising memory use (queue, jemalloc); staff needing HEIC or AVIF (phones); a request to keep originals or re-crop; the emulator moving to Garage (re-check checksums and anonymous read); a SeaweedFS release that documents the SDK's default checksums (drop the override); a new `sharp` minor with a libvips licence or platform change; a run-time need to change the photo limits (`app_settings`).
