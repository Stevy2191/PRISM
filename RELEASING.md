# Releasing PRISM

How a change gets from a branch to a running instance, and how to get back if
a release goes wrong.

## Branches and what CI builds

| Ref pushed | Images published |
|---|---|
| `dev` | `:dev`, `:sha-<sha>` |
| `main` | `:main`, `:latest`, `:sha-<sha>` |
| tag `v0.2.0` | `:0.2.0`, `:0.2`, `:sha-<sha>` |

Two properties worth knowing:

- **`:latest` moves only on the default branch.** A push to `dev` cannot change
  what a production stack pulls.
- **The test suite gates the build.** A failing suite stops the release instead
  of publishing anyway.

Work happens on `dev`. When it is ready, merge to `main` and tag.

## Cutting a release

1. Merge `dev` into `main` and push. CI publishes `:latest`.
2. Move anything under `## Unreleased` in `UPGRADING.md` into a section for the
   new version. If the release changes an API response, a required environment
   variable, or a permission, say so there — that file is what an operator
   reads before upgrading.
3. Tag the merge commit and push the tag:

       git tag -a v0.2.0 -m "Short summary of the release"
       git push origin v0.2.0

   CI then publishes `:0.2.0` and `:0.2`.

Version numbers are `MAJOR.MINOR.PATCH`. Bump MINOR for new features, PATCH for
fixes alone, MAJOR for a change that requires the operator to do something
irreversible. Note that the number lives in the git tag only — the `version`
fields in `backend/package.json` and `frontend/package.json` are **not** part of
this process and are not read by anything.

## Deploying a version

`IMAGE_TAG` in a stack's `.env` decides which build it runs. It defaults to
`latest`.

    cd /srv/docker/prism
    docker compose pull
    docker compose up -d

To pin an exact release instead of tracking `latest`:

    IMAGE_TAG=0.2.0

Migrations run automatically when the backend starts.

## Rolling back

Set `IMAGE_TAG` to the previous version and bring the stack back up:

    IMAGE_TAG=0.1.0
    docker compose pull && docker compose up -d

**A rollback undoes code, not the database.** If the release you are backing out
of ran a migration that dropped or rewrote a column, the older image may not be
able to read the schema it now finds. Check the release's `UPGRADING.md` section
before rolling back across a migration, and take a database dump first:

    docker compose exec mariadb sh -c \
      'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" prism' > prism-backup.sql

## Confirming what is running

Settings shows the running version in the page footer. Over the API, as any
logged-in user:

    GET /api/v1/version  ->  { "version": "0.2.0", "gitSha": "a1b2c3d", "release": true }

`release` is false for a build from a branch rather than a tag — such a build
reports its branch name (`dev`) as the version. The unauthenticated
`/api/v1/health` endpoint deliberately does **not** carry the version: handing
an exact version to anonymous callers is handing over a list of CVEs to try.

An image also carries its version as an OCI label, readable without starting it:

    docker image inspect ghcr.io/stevy2191/prism-backend:0.2.0 \
      --format '{{ index .Config.Labels "org.opencontainers.image.version" }}'

## Test instances

A stack tracking `dev` is a test instance:

    IMAGE_TAG=dev

Give it its own directory, its own `.env` (its own database password, session
secret and encryption key) and its own host port, so nothing is shared with a
production stack. `/srv/docker/prism` on the build host is set up this way.

To test work that is not committed yet, build from a checkout instead of
pulling:

    docker compose -f docker-compose.dev.yml up -d --build

An image built that way has no ref to derive a version from, so it reports
`dev` / `unknown`.
