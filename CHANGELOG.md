# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial extension scaffold with backend REST API and frontend React panel
- `can_read` / `can_write` permission gating via FAB `marimo_notebooks` view
- SQL Lab panel (`sqllab.panels`) with notebook list and viewer iframe
- "Open in Notebook" command in the SQL Lab editor secondary toolbar
- Signed launch tokens (itsdangerous) for Marimo sidecar session auth
- Database context forwarding (db_id, schema, table) from active SQL Lab tab
- CI workflow: backend lint (ruff, mypy), tests (pytest), frontend type-check and build
- Release workflow: version stamp, frontend build, `.supx` bundle, GitHub release asset
