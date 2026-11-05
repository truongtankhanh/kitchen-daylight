# ADR-0004: AWS hosting, environments and delivery

- **Status:** **Accepted** by the project owner on 2026-10-21: AWS as the platform, a budget of about USD 50/month for all tiers, three tiers (`dev`, `demo`, `prod`), `dev` running locally on emulators, and `demo` being stopped when idle. The component choices and cost figures below are still **Proposed**/unverified until checked in the AWS Pricing Calculator.
- **Date:** 2026-10-21 (revised the same day after the budget was stated)
- **Depends on:** [ADR-0001](0001-tech-stack.md), [ADR-0003](0003-authentication.md)

## Revision note

The first draft proposed ECS Fargate + ALB + RDS + WAF. With a budget of about USD 50/month across three tiers that design does not fit: one ALB plus a small Fargate task plus a small RDS instance is estimated at roughly USD 50-60 per tier before NAT or WAF. This revision keeps the same application and container image and swaps the hosting layer for a cheaper one. The original design is kept below as the **upgrade path**.

All prices in this document are **estimates from memory, not verified**. Singapore is usually more expensive than us-east-1. Validate with the AWS Pricing Calculator before committing.

## Context

- Three tiers, each of which must support **full testing**: every feature path must be exercisable in every tier (authentication including email flows, image upload, geocoding, nearby search, admin RBAC, mobile end-to-end).
- Hard budget: about USD 50/month in total.
- Traffic is unknown and expected to be small.
- ADR-0003 needs a stable same-site origin for the admin cookie, and one API instance per tier for in-process rate limiting.

## Decision

### 1. One container topology, identical in every tier

Each tier runs the same Docker Compose topology and the **same image**. Only configuration differs (environment variables and parameter store values).

```
Caddy (TLS, reverse proxy, serves admin SPA)
  ├─ /      → static Angular admin build
  └─ /api   → NestJS API container
PostgreSQL + PostGIS container (EBS-backed volume)
```

One host name per tier (for example `demo.<domain>`, `<domain>`) serves the admin at `/` and the API at `/api`. That satisfies the same-site cookie design in ADR-0003 without CORS or extra certificates.

### 2. Tiers

| | `dev` | `demo` | `prod` |
|---|---|---|---|
| Purpose | Daily development, destructive testing | Stakeholder demo and rehearsal of real AWS integrations before release; target of mobile e2e runs | Real users |
| Where it runs | Developer machine; the local services come from the separate Docker repository ([ADR-0010](0010-repository-layout-and-local-docker-repo.md)) | EC2 `t4g.small` (ARM), can be stopped when not in use | EC2 `t4g.small` (ARM), always on |
| Email | Mailpit (local SMTP sink) | Amazon SES (sandbox, verified recipients only) | Amazon SES (production access) |
| Object storage | An S3-compatible emulator in the Docker repository (same SDK, different endpoint). MinIO was the first idea, but its community edition is no longer distributed as images (ADR-0010 addendum); the product is chosen in the Docker repository's phase 0 | S3 bucket (own bucket) + CloudFront | S3 bucket (own bucket) + CloudFront |
| Geocoding | Deterministic fixture adapter | Amazon Location Service | Amazon Location Service |
| Data | Synthetic and VER.01 seed | Anonymised seed plus synthetic. **Never prod user data.** | Real |

**How every tier tests fully:** the application reaches mail, storage and geocoding through three ports (`MailPort`, `StoragePort`, `GeocodePort`). `dev` binds them to local emulators, `demo` and `prod` bind them to the real AWS services. All flows run in all tiers; `demo` is where the real-service paths are proven before `prod`. Mobile builds select the tier through build-time environment configuration, so one build profile exists per tier.

**Production safety guard:** the API refuses to boot when `APP_ENV=prod` and any port is bound to an emulator or fixture adapter. This is a blocking requirement, not a nice-to-have.

### 3. Component choices

| Concern | Choice | Notes |
|---|---|---|
| Region | `ap-southeast-1` (Singapore) | Confirm latency from Vietnam. |
| Compute | EC2 `t4g.small` per cloud tier | 2 GB RAM is enough for API + Postgres/PostGIS + Caddy at low traffic. Watch memory; swap file as a safety margin. |
| AWS access | EC2 instance profile with least-privilege policy per tier (that tier's S3 bucket, SES send, Location geocode, its SSM parameters) | No long-lived AWS keys on the host. (Lightsail was rejected because instances cannot assume an IAM role.) |
| Database | PostgreSQL + PostGIS in a container, data on an EBS volume | Managed RDS is the upgrade path. Trade-offs in Consequences. |
| Backups | Nightly `pg_dump` to a versioned S3 bucket with lifecycle expiry, plus daily EBS snapshots; **monthly restore test** | No point-in-time recovery initially. WAL archiving is a later option. |
| Secrets and config | SSM Parameter Store (`SecureString` for secrets: DB password, JWT signing keys); non-secret config as plain parameters | Secrets Manager is avoided because it bills per secret. |
| Uploads | API receives admin uploads (multipart, size and content-type validated), resizes with `sharp`, writes variants to S3. Images are served through CloudFront. | No Lambda and no presigned flow: uploads are admin-only and low volume. |
| Mail | SES | Verify the sending domain (SPF, DKIM, DMARC) and request production access before `prod` launch. Bounce and complaint notifications arrive through SNS at an internal endpoint and feed the send log and the suppression table (ADR-0008 #34). |
| Realtime | Socket.IO gateway inside the API container | Caddy must pass WebSocket upgrades on `/api`. One instance per tier means no sticky sessions or shared bus yet; both become blocking conditions when scaling out, together with rate limiting ([ADR-0007](0007-realtime-sync.md)). |
| Background work | In-process: outbox relay, export jobs (Postgres-backed queue), nightly reconcile and purge jobs | No Redis and no separate worker container while there is one API instance. A long export competes with API requests for the same 2 GB, so exports have a row cap and run one at a time. |
| Encryption at rest | EBS volumes encrypted; S3 buckets use SSE; `pg_dump` backups land in an encrypted bucket | Stated here because the data model requires it (personal data lifecycle). Add `Encrypted: true` to the CDK volume definitions. |
| Rate limiting | In-process throttling in the API (strict on auth paths) + per-account counters in Postgres | Valid only while each tier runs **one** API instance. See ADR-0003. |
| IaC | AWS CDK (TypeScript) in `infra/` | One stack per cloud tier, parameterised. |
| Registry | ECR with a lifecycle policy (keep the last N images) | Instances pull with their instance role. |
| CI/CD | GitHub Actions, AWS access via OIDC role assumption. Deploy by AWS Systems Manager Run Command: run migrations as a one-off container, then `docker compose pull && up -d`. | No SSH and no inbound port 22. |
| Network | Security group allows only 80/443 inbound | Database is not published to the host network. |
| DNS and TLS | Route 53 hosted zone; Caddy obtains and renews certificates automatically | |
| Observability | Sentry (errors), Docker log rotation, CloudWatch alarm on instance status and disk, external uptime check, AWS Budgets alert | CloudWatch Logs ingestion is skipped by default to save cost. |
| Mobile delivery | EAS Build/Submit/Update, or local builds | EAS free-plan limits were not verified. Local builds are the fallback. |

### 4. Estimated monthly cost (unverified)

| Item | Estimate |
|---|---|
| `prod` EC2 `t4g.small`, 24x7 | about USD 15 |
| `demo` EC2 `t4g.small`, running about a quarter of the time | about USD 4 plus its volume |
| EBS volumes (about 20 GB each) | about USD 4 |
| Public IPv4 for `prod` (and `demo` while running) | about USD 4-7 |
| S3, CloudFront (free allowance), ECR, SSM, SES, Location geocoding, backups, Route 53 zone | about USD 4-8 |
| **Total** | **about USD 35-45** |

The demo tier is cost-controlled by stopping it when idle. Its public IP is released on stop, so a boot hook updates its DNS record on start. If `demo` runs 24x7 the total moves toward the USD 50 limit with little margin. These numbers must be checked in the Pricing Calculator.

**Not included in the USD 50:** Apple Developer Program (USD 99/year), Google Play registration (one-time USD 25), and the domain registration.

## Upgrade path

Because the app is containerised and uses ports for external services, moving to the managed design is an infrastructure change, not an application rewrite:

- API containers → **ECS on Fargate** behind an ALB (App Runner closed to new customers on 2026-04-30, so it is not an option; see References).
- Postgres container → **RDS for PostgreSQL** (verify PostGIS, `pg_trgm`, `unaccent` for the chosen engine version), Multi-AZ for prod, automated backups with point-in-time recovery.
- Add **AWS WAF** rate-based rules, and move rate limiting to a shared layer **before** running more than one API instance.
- Secrets Manager for rotation of DB credentials.

## Alternatives considered

- **Full managed stack per tier (Fargate, ALB, RDS, WAF):** correct for production, over budget by a wide margin for three tiers.
- **Lightsail:** cheapest and simplest, but no IAM role for instances, which forces long-lived access keys. Rejected.
- **One shared EC2 instance for all tiers:** cheapest, but no isolation between `prod` and the others; a bad demo deploy can take production down. Rejected.
- **`dev` in the cloud as well:** a third instance would be roughly USD 20 and break the budget. `dev` uses local emulators instead and still exercises every flow.
- **Lambda + API Gateway:** poor fit with a conventional Postgres/TypeORM API at this size. *(Wording corrected 2026-10-27; this line said Prisma before ADR-0001 accepted TypeORM.)*

## Consequences

- **Single point of failure in `prod`:** one instance, one disk, no Multi-AZ. An instance or AZ failure means downtime until restore. Accepted because of the budget.
- **Self-managed database:** we own patching, backups, restore tests and disk growth. No point-in-time recovery until WAL archiving is added. A missed restore test means a backup that may not work.
- The API runs as one instance per tier; scaling out requires moving the rate limiting first (see Upgrade path).
- `demo` and `prod` differ from `dev` in real-service behaviour (SES sandbox, Location provider quality). That is exactly what `demo` exists to catch.
- Deploys cause a short restart gap unless a rolling strategy is added later.

## Open items

1. Verify prices in the AWS Pricing Calculator (Singapore) and confirm the estimate fits.
2. **Updated by [ADR-0009](0009-owner-business-pivot.md) (2026-10-27):** the open-data import is gone, so the data is small (one restaurant, a few branches). The real question is now **availability**: a single instance with no Multi-AZ, accepted when this was a demo, means an outage during service loses real orders. The owner must state a recovery expectation; a restore-tested backup, idempotent order creation and a staff board that refetches on its own are required either way. Confirm that 2 GB is enough with sockets, exports and PostGIS. The text that follows is the earlier capacity analysis for the import and is kept as history. **Two loads are not yet reconciled**: the 289 migrated places (small), and the accepted open-data import ([ADR-0008](0008-open-items-resolution.md) #13), which is 86,000 places at confidence 0.8 or up to 313,000 for the whole country, each with children and a trigram index, plus the realtime sockets and the export jobs. Measure on the one-province spike before any bulk import; if 2 GB does not hold, options are importing a smaller set (one province, higher confidence), or `t4g.medium` for `prod`, which raises the cost. Do not run the bulk import on `prod` first.
3. How often `demo` really needs to run; automate start/stop and the DNS update.
4. Domain name and registrar.

## References

- [AWS App Runner availability change](https://docs.aws.amazon.com/ja_jp/apprunner/latest/dg/apprunner-availability-change.html): App Runner closed to new customers on 2026-04-30; ECS Express Mode is AWS's suggested replacement.
