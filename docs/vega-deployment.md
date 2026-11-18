# Deploying Wellspan to Vega

After merging this PR, run from the existing staging checkout:

```bash
cd ~/dev/project/wellspan
./deploy.sh
```

Requires a clean checkout of `main` with an `origin` remote, Docker daemon access, `curl`, and `flock`. The script fetches `origin/main` and merges fast-forward-only, builds `wellspan:staging-candidate`, then replaces the old staging container only after the image builds successfully.

## Existing staging settings

| Setting | Value |
| --- | --- |
| Container | `wellspan-staging` |
| Image | `wellspan:staging` |
| SQLite volume | `wellspan-staging-data` mounted at `/data` |
| Host binding | `127.0.0.1:18788:8080` |
| Tailscale Serve | Existing private HTTPS `:18789` route, unchanged |
| Security | Read-only root FS, `/tmp` tmpfs, no-new-privileges, drop all capabilities |
| Restart policy | `unless-stopped` |

The script refuses to proceed if the staging container or volume is missing, or if its data mount, published port, or image identity differs. It intentionally does not use the repository's `compose.yaml`, because that configuration uses port 8788 and a different volume. It does not modify other containers or Tailscale settings and does not use `docker rm -v`, `docker volume rm`, or `docker compose down -v`.

## Rollback and limitations

If replacement fails health or API checks, the script attempts to restore the previous image against the same SQLite volume. The previous image is retained under `wellspan:staging-rollback`. This is *image rollback*, not database rollback. Before schema-changing upgrades, verify a consistent SQLite backup and restoration process; the script does not perform backups. A future schema migration may be incompatible with an older application image.

Expect a short service interruption during container replacement. The Tailscale HTTPS route remains unchanged.

Post-deployment checks:

```bash
docker ps --filter name=wellspan-staging
docker inspect -f '{{.State.Health.Status}}' wellspan-staging
curl -fsS http://127.0.0.1:18788/api/v1/state
tailscale serve status
```

This script updates only Vega staging. It does not initialize food data, run Lobo, deploy production or expose public ports. Do not use Tailscale Funnel for this unauthenticated service.
