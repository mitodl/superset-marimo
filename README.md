# Marimo Notebooks — Apache Superset Extension

A Superset 6.1+ extension that adds a **Notebooks** panel to SQL Lab, allowing users to open reactive [Marimo](https://marimo.io) Python notebooks pre-connected to the same data sources configured in Superset.

## Overview

Notebooks are **global** — all created notebooks are visible to every user with access to the extension. This keeps the model simple and encourages shared analytical work. For private, user-scoped, or collaborative notebooks, use the team's JupyterHub deployment instead.

```
SQL Lab  →  Notebooks panel  →  Marimo sidecar  →  S3 (ol-superset-{env}/notebooks/)
```

## Permission model

Two FAB permissions are created when the extension loads (`view_menu = marimo_notebooks`):

| Permission | Roles | Capability |
|---|---|---|
| `can_read` | `ol_data_engineer`, `ol_business_analyst`, `ol_researcher`, `ol_data_analyst`, `ol_instructor` | List and view notebooks (read-only `marimo run` mode) |
| `can_write` | `ol_data_engineer`, `ol_business_analyst` | Create notebooks and open in edit mode (`marimo edit`) |

Add these to `ol_governance_roles.json` in `ol-infrastructure` and redeploy. See [Permission Setup](#permission-setup) below.

## Architecture

```
┌─────────────────────────────────────┐
│  Superset pod                        │
│  ┌─────────────────────────────────┐ │
│  │  Extension backend (Flask/FAB)  │ │   IRSA
│  │  /extensions/mitodl/marimo-...  │─┼──────► S3: ol-superset-{env}/notebooks/
│  └─────────────┬───────────────────┘ │
└────────────────┼────────────────────┘
                 │ signed launch token
                 ▼
┌─────────────────────────────────────┐
│  Marimo sidecar (superset namespace) │
│  FastAPI + marimo.create_asgi_app() │
│  ┌───────────────────────────────┐  │   IRSA
│  │  /api/notebooks  (CRUD)       │──┼──────► S3 (same bucket, same prefix)
│  │  /{notebook_id}  (serve)      │  │
│  └───────────────────────────────┘  │
│  watchdog: local .py → S3 on save   │
└─────────────────────────────────────┘
```

**Persistence:** The Marimo sidecar syncs notebooks to and from S3 (`ol-superset-{env}/notebooks/*.py`) using a `watchdog` file watcher. On pod startup, all notebooks are pulled from S3 to a local directory. On any `.py` file change (i.e., a save in the Marimo editor), the updated file is pushed back to S3. Active edit sessions use local disk as the write buffer; a pod eviction during an unsaved edit loses only that session's unsaved changes.

## Superset configuration

Add the following to `superset_config.py` (or pass as environment variables):

```python
# Base URL of the Marimo sidecar service (in-cluster DNS)
MARIMO_SIDECAR_URL = os.environ.get(
    "MARIMO_SIDECAR_URL",
    "http://marimo.superset.svc.cluster.local:8080",
)
```

## Deployment

### Build and bundle

```bash
# Install the CLI
pip install apache-superset-extensions-cli

# Build frontend
cd frontend && npm ci && npm run build && cd ..

# Bundle into .supx
superset-extensions bundle
# → mitodl.marimo-notebooks-{version}.supx
```

### Install

Copy the `.supx` to the directory configured in `superset_config.py`:

```python
FEATURE_FLAGS = {"ENABLE_EXTENSIONS": True}
EXTENSIONS_PATH = "/app/extensions"
```

Then restart Superset. The extension loads automatically on startup.

### Releases

Push a tag matching `v[0-9]+.[0-9]+.[0-9]+` to trigger the [release workflow](.github/workflows/release.yml), which builds the `.supx` and attaches it to a GitHub release.

```bash
git tag v1.0.0
git push origin v1.0.0
```

### Permission setup

After the first deployment, add to `ol_governance_roles.json` in `ol-infrastructure`:

```json
{"permission": {"name": "can_read"},  "view_menu": {"name": "marimo_notebooks"}}
{"permission": {"name": "can_write"}, "view_menu": {"name": "marimo_notebooks"}}
```

Assign `can_read` to `ol_data_engineer`, `ol_business_analyst`, `ol_researcher`, `ol_data_analyst`, `ol_instructor`.
Assign `can_write` to `ol_data_engineer`, `ol_business_analyst`.

The `flask fab import-roles` command in the Helm init script picks this up on next deployment.

## Development

### Code checks

From the repository root, run [prek](https://prek.j178.dev/), which reads `.pre-commit-config.yaml`. Use the version pinned in `.github/workflows/autofix.yml`:

```bash
uv tool install prek==0.5.3
prek install -f      # replaces an existing pre-commit git hook
prek run --all-files
```

The `prek` check runs every hook on pull requests and pushes to `main`. On pull requests, [autofix.ci](https://autofix.ci/) pushes a commit with any converged fixes. Fixes under `.github/` must be committed locally.

### Backend

```bash
cd backend
uv sync --extra dev
uv run pytest tests/
uv run ruff check src/
uv run mypy src/
```

### Frontend

```bash
cd frontend
npm ci
npm run typecheck
npm run build
```

For hot-reload against a running Superset instance, add the extension to `LOCAL_EXTENSIONS` in `superset_config.py`:

```python
LOCAL_EXTENSIONS = ["/path/to/superset-marimo"]
```

Then run the webpack dev server:

```bash
cd frontend && npm start
```

## Project structure

```
superset-marimo/
├── extension.json              # Extension metadata
├── backend/
│   ├── src/mitodl/marimo_notebooks/
│   │   ├── api.py              # REST API (Flask-AppBuilder)
│   │   └── entrypoint.py       # Auto-loaded by Superset
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── index.tsx           # Extension entry point — all registrations
│   │   ├── NotebookPanel.tsx   # SQL Lab panel component
│   │   └── types.ts
│   ├── webpack.config.js       # Module Federation config
│   └── package.json
└── .github/workflows/
    ├── ci.yml                  # Lint, type-check, test on push/PR
    └── release.yml             # Build .supx and publish on tag
```

## Related

- [Marimo sidecar deployment](https://github.com/mitodl/ol-infrastructure) — K8s Deployment, Service, Vault secrets, and S3 sync configuration live in `ol-infrastructure`
- [Superset deployment](https://github.com/mitodl/ol-infrastructure/tree/main/src/ol_infrastructure/applications/superset)
- [Marimo documentation](https://docs.marimo.io)
- [Superset extension system](https://superset.apache.org/developer-docs/extensions/overview/)
