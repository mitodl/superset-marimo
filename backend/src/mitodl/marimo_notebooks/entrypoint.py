# Licensed under BSD-3-Clause. See LICENSE in the project root.
"""
Extension entrypoint — importing this module registers all extension contributions.

Superset auto-discovers this file via the manifest's backend.entrypoint path.
The import of NotebookAPI triggers the @api decorator, which registers the
REST endpoints under /extensions/mitodl/marimo-notebooks/.
"""

from .api import NotebookAPI as NotebookAPI  # noqa: F401
