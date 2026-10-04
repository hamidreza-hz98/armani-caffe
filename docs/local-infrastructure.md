# Local infrastructure

This stack is for development only. Install Docker Desktop (Linux containers) or Docker Engine with Compose v2, then run commands from the `armani-caffe` directory. Next.js runs on the host with `npm run dev`; it is not part of Compose.

## Start

```bash
npm run infra:up
npm run infra:init:mongo
npm run infra:init:minio
npm run infra:status
npm run infra:smoke
```

`infra:up` starts MongoDB, Redis, and MinIO and waits for their health checks. The MongoDB init step creates `rs0` only if needed and waits for the single member to become primary. The separate MinIO init step creates `armani-media`, removes anonymous bucket access, applies the allowed-origin CORS policy, and briefly restarts MinIO to activate it. Both init commands can be rerun against the same local volumes; rerunning MinIO init briefly interrupts its API.

The smoke command commits a MongoDB transaction, checks Redis AOF settings and a value across a Redis container restart, reruns MinIO initialization, and confirms an anonymous media request receives HTTP 403. It temporarily restarts Redis, so run it when no local queue worker needs uninterrupted access.

| Service       | Compose DNS name | Host address            |
| ------------- | ---------------- | ----------------------- |
| MongoDB       | `mongodb:27017`  | `127.0.0.1:27018`       |
| Redis         | `redis:6379`     | `127.0.0.1:6379`        |
| MinIO API     | `minio:9000`     | `http://127.0.0.1:9000` |
| MinIO Console | `minio:9001`     | `http://127.0.0.1:9001` |

For a host-run MongoDB client using Compose, use `mongodb://127.0.0.1:27018/armani_caffe?directConnection=true&replicaSet=rs0`. The replica set advertises `mongodb:27017` for containers, so `directConnection=true` is needed for host clients. The local Redis URL is `redis://127.0.0.1:6379`. The media bucket is `armani-media`.

On Windows without Docker, `pwsh -File scripts/start-local-mongo.ps1` starts a project-only single-node replica set at `127.0.0.1:27018` with data in ignored `data/mongodb`. It is named **`rsowner`**, so MongoDB Compass and `.env.local` must use `mongodb://127.0.0.1:27018/armani_caffe?directConnection=true&replicaSet=rsowner`. This local process and Compose cannot use port 27018 simultaneously. Port 27017 on this workstation belongs to another standalone MongoDB instance and must not be used for Armani Caffe.

The defaults `armani_dev` / `armani_dev_password_change_me` for MinIO are intentionally unsafe for production. MongoDB and Redis have **no authentication** in this loopback-only stack. Do not reuse this Compose file or its credentials for deployment. To override local defaults, set `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_MEDIA_BUCKET`, `MINIO_CORS_ORIGINS`, `MONGO_PORT`, `REDIS_PORT`, `MINIO_API_PORT`, or `MINIO_CONSOLE_PORT` in your shell before running the commands. Keep real values in ignored local environment files, never in Git. If you change the bucket name, rerun `infra:init:minio`.

The CORS policy allows browser origins `http://localhost:3000` and `http://127.0.0.1:3000`. Community MinIO does not support bucket-specific CORS, so this is a server-wide allowed-origin setting. CORS does not make the bucket public; clients still need signed requests. Set `MINIO_CORS_ORIGINS` to a comma-separated origin list and rerun `npm run infra:init:minio` if the development origin changes.

## Stop and inspect

```bash
npm run infra:status
docker compose -f infra/compose.yaml logs --tail=100 mongodb redis minio
npm run infra:down
```

`infra:down` removes containers and the network but preserves named volumes. Start again with `infra:up`; initialization is idempotent.

## Reset local data — opt-in and destructive

The following command permanently removes the stack's MongoDB, Redis, and MinIO named volumes. Run it only when you intend to discard local databases, queued jobs, and uploaded objects:

```bash
docker compose -f infra/compose.yaml down --volumes
```

Then repeat the Start sequence. There is deliberately no `npm run infra:reset` shortcut.

## Troubleshooting

MinIO's community repository is archived and official legacy binary downloads are no longer served. The historical pinned image may not be obtainable on a new machine. Do not silently substitute an unreviewed image or service; use an already available trusted build for local testing, or make an explicit supported-storage decision before provisioning/deployment. See [ADR 0003](adr/0003-private-media-storage.md). Real-media integration tests can target a dedicated existing MinIO server using the `MINIO_TEST_*` variables in [media storage](media-storage.md).

- `docker` is unavailable: install or start Docker Desktop/Engine, enable Linux containers, and confirm `docker compose version`.
- A port is occupied: set the corresponding `*_PORT` variable in your shell, then run `infra:up` again. Update host connection URLs accordingly.
- MongoDB reports `NotYetInitialized` or transactions fail: run `npm run infra:init:mongo`, then confirm `npm run infra:smoke`. Do not change the replica-set member host to `localhost`; containers use `mongodb`.
- Redis value disappears after restart: inspect `docker compose -f infra/compose.yaml logs redis`, check volume mounts and AOF settings with `docker compose -f infra/compose.yaml exec redis redis-cli CONFIG GET appendonly appendfsync`.
- MinIO bucket is missing or CORS changed: run `npm run infra:init:minio`; check its output and the MinIO logs. An anonymous HTTP 403 for a media object is expected and confirms private access.
- A service is unhealthy: run `npm run infra:status` and inspect its logs. On Windows, ensure Docker Desktop has enough memory and its Linux engine is running.

The infrastructure choice and durability limits are recorded in [ADR 0001](adr/0001-local-infrastructure.md).
