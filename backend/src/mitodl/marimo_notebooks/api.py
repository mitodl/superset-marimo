# Licensed under BSD-3-Clause. See LICENSE in the project root.
"""
REST API for the Marimo Notebooks Superset extension.

Permission model (FAB view: "marimo_notebooks"):
  can_read  — list notebooks, view a notebook (read-only Marimo run mode)
  can_write — create notebooks, launch in edit mode

Role assignments are managed in ol-infrastructure via ol_governance_roles.json:
  ol_data_engineer, ol_business_analyst  → can_read + can_write
  ol_researcher, ol_data_analyst, ol_instructor → can_read only
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

from flask import Response, current_app
from flask_appbuilder.api import expose, permission_name, protect, safe
from flask_login import current_user
from itsdangerous import URLSafeTimedSerializer
from superset_core.rest_api.api import RestApi
from superset_core.rest_api.decorators import api

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# How long a Marimo launch token stays valid (seconds).
LAUNCH_TOKEN_TTL = 300

# Salt values keep launch tokens separate from other itsdangerous usages
# (e.g. Superset's own session cookies which use a different salt).
_LAUNCH_SALT = "marimo-notebooks-launch"


def _marimo_sidecar_url() -> str:
    """Return the base URL of the Marimo sidecar service.

    Reads MARIMO_SIDECAR_URL from superset_config.py (passed through
    the Helm chart as an environment variable).  Falls back to the
    in-cluster service DNS name so local/test environments still work
    without explicit config.
    """
    return current_app.config.get(
        "MARIMO_SIDECAR_URL",
        os.environ.get(
            "MARIMO_SIDECAR_URL",
            "http://marimo.superset.svc.cluster.local:8080",
        ),
    )


def _sign_launch_token(payload: dict[str, object]) -> str:
    """Sign a launch payload using Superset's SECRET_KEY.

    The Marimo sidecar validates this token using the same key before
    starting a notebook session, ensuring that only properly authorized
    launch requests are honoured.
    """
    s = URLSafeTimedSerializer(current_app.config["SECRET_KEY"])
    return s.dumps(payload, salt=_LAUNCH_SALT)


@api(
    id="notebook_api",
    name="Marimo Notebooks API",
    description=(
        "Manage and launch Marimo notebook sessions connected to "
        "Superset-configured data sources."
    ),
)
class NotebookAPI(RestApi):
    """REST API for Marimo notebook lifecycle management.

    All endpoints live under /extensions/mitodl/marimo-notebooks/.
    """

    class_permission_name = "marimo_notebooks"

    # ------------------------------------------------------------------
    # Capabilities
    # ------------------------------------------------------------------

    @expose("/capabilities", methods=("GET",))
    @protect()
    @safe
    @permission_name("read")
    def get_capabilities(self) -> Response:
        """Return what the current user is permitted to do.

        The frontend calls this once at panel mount to decide which UI
        controls to render.  Hard enforcement still happens on every
        subsequent API call — this endpoint is convenience only.

        ---
        get:
          summary: Get user capabilities
          responses:
            200:
              description: Capabilities for the current user
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: object
                        properties:
                          can_create_notebooks:
                            type: boolean
                          notebook_launch_mode:
                            type: string
                            enum: [edit, run]
            401:
              $ref: '#/components/responses/401'
        """
        sm = self.appbuilder.sm
        can_write = sm.has_access("can_write", "marimo_notebooks")
        return self.response(
            200,
            result={
                "can_create_notebooks": can_write,
                "notebook_launch_mode": "edit" if can_write else "run",
            },
        )

    # ------------------------------------------------------------------
    # Notebook catalogue
    # ------------------------------------------------------------------

    @expose("/", methods=("GET",))
    @protect()
    @safe
    @permission_name("read")
    def list_notebooks(self) -> Response:
        """List notebooks accessible to the current user.

        Proxies the notebook index from the Marimo sidecar so the
        frontend only needs to know about the Superset extension API.

        ---
        get:
          summary: List available notebooks
          responses:
            200:
              description: List of notebooks
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: array
                        items:
                          type: object
                          properties:
                            id:
                              type: string
                            name:
                              type: string
                            created_at:
                              type: string
                            updated_at:
                              type: string
            401:
              $ref: '#/components/responses/401'
        """
        import requests  # noqa: PLC0415

        try:
            resp = requests.get(
                f"{_marimo_sidecar_url()}/api/notebooks",
                timeout=10,
            )
            resp.raise_for_status()
            return self.response(200, result=resp.json())
        except Exception:  # noqa: BLE001
            logger.exception("Failed to fetch notebook list from Marimo sidecar")
            return self.response(503, message="Marimo sidecar unavailable")

    @expose("/", methods=("POST",))
    @protect()
    @safe
    @permission_name("write")
    def create_notebook(self) -> Response:
        """Create a new notebook and return its launch URL.

        Accepts an optional JSON body with ``db_id`` and ``table`` to
        pre-populate the notebook with a connection cell targeting that
        data source.

        ---
        post:
          summary: Create a new notebook
          requestBody:
            content:
              application/json:
                schema:
                  type: object
                  properties:
                    db_id:
                      type: integer
                      description: Superset database ID to pre-connect
                    schema:
                      type: string
                    table:
                      type: string
          responses:
            201:
              description: Notebook created
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: object
                        properties:
                          notebook_id:
                            type: string
                          launch_url:
                            type: string
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
        """
        import requests as http  # noqa: PLC0415
        from flask import request  # noqa: PLC0415

        body = request.get_json(silent=True) or {}
        db_id: int | None = body.get("db_id")
        schema: str | None = body.get("schema")
        table: str | None = body.get("table")

        # Resolve the connection URI template for the requested database so
        # the Marimo sidecar can inject it without knowing Superset's internals.
        uri_template: str | None = None
        if db_id is not None:
            uri_template = _resolve_db_uri_template(db_id)

        try:
            resp = http.post(
                f"{_marimo_sidecar_url()}/api/notebooks",
                json={
                    "uri_template": uri_template,
                    "schema": schema,
                    "table": table,
                },
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception:  # noqa: BLE001
            logger.exception("Failed to create notebook via Marimo sidecar")
            return self.response(503, message="Marimo sidecar unavailable")

        notebook_id: str = data["notebook_id"]
        launch_url = _build_launch_url(notebook_id, mode="edit")
        return self.response(
            201, result={"notebook_id": notebook_id, "launch_url": launch_url}
        )

    # ------------------------------------------------------------------
    # Launch endpoints
    # ------------------------------------------------------------------

    @expose("/<string:notebook_id>/launch", methods=("POST",))
    @protect()
    @safe
    @permission_name("write")
    def launch_edit(self, notebook_id: str) -> Response:
        """Return a signed launch URL for editing a notebook.

        Only roles with ``can_write`` on ``marimo_notebooks`` may open
        notebooks in edit mode.

        ---
        post:
          summary: Launch notebook in edit mode
          parameters:
            - in: path
              name: notebook_id
              schema:
                type: string
              required: true
          responses:
            200:
              description: Launch URL
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: object
                        properties:
                          launch_url:
                            type: string
            401:
              $ref: '#/components/responses/401'
            403:
              $ref: '#/components/responses/403'
        """
        return self.response(
            200,
            result={"launch_url": _build_launch_url(notebook_id, mode="edit")},
        )

    @expose("/<string:notebook_id>/view", methods=("GET",))
    @protect()
    @safe
    @permission_name("read")
    def launch_readonly(self, notebook_id: str) -> Response:
        """Return a signed launch URL for viewing a notebook read-only.

        All roles with ``can_read`` on ``marimo_notebooks`` may open
        notebooks in read-only (``marimo run``) mode.

        ---
        get:
          summary: Launch notebook in read-only mode
          parameters:
            - in: path
              name: notebook_id
              schema:
                type: string
              required: true
          responses:
            200:
              description: Launch URL
              content:
                application/json:
                  schema:
                    type: object
                    properties:
                      result:
                        type: object
                        properties:
                          launch_url:
                            type: string
            401:
              $ref: '#/components/responses/401'
        """
        # Honour the user's write permission — give edit mode if they have it.
        sm = self.appbuilder.sm
        mode = "edit" if sm.has_access("can_write", "marimo_notebooks") else "run"
        return self.response(
            200,
            result={"launch_url": _build_launch_url(notebook_id, mode=mode)},
        )


# ---------------------------------------------------------------------------
# Helpers (module-private)
# ---------------------------------------------------------------------------


def _build_launch_url(notebook_id: str, mode: str) -> str:
    """Build a signed URL the browser can use to open a Marimo session.

    The Marimo sidecar validates the token before starting the session,
    so this URL cannot be forged or replayed after LAUNCH_TOKEN_TTL seconds.
    """
    user_id: int = getattr(current_user, "id", 0)
    token = _sign_launch_token(
        {"user_id": user_id, "notebook_id": notebook_id, "mode": mode}
    )
    return f"{_marimo_sidecar_url()}/{notebook_id}?token={token}&mode={mode}"


def _resolve_db_uri_template(db_id: int) -> str | None:
    """Return the SQLAlchemy URI template for a Superset database ID.

    The URI may contain ``${ENV_VAR_NAME}`` placeholders (per the
    DB_CONNECTION_MUTATOR pattern in superset_config.py).  These are
    intentionally left unresolved here — the Marimo sidecar has the same
    Vault-injected environment variables and resolves them identically.
    """
    try:
        from superset.models.core import Database  # noqa: PLC0415

        db = Database.get(db_id)
        if db is None:
            return None
        # sqlalchemy_uri may be encrypted; .sqlalchemy_uri_decrypted is the
        # unencrypted form exposed by Superset's Database model.
        return getattr(db, "sqlalchemy_uri_decrypted", None) or str(db.sqlalchemy_uri)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to resolve URI template for db_id=%s", db_id)
        return None
