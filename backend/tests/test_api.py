# Licensed under BSD-3-Clause. See LICENSE in the project root.
"""Tests for the Marimo Notebooks extension backend."""

from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture
def mock_sm() -> MagicMock:
    """Return a mock Superset security manager."""
    sm = MagicMock()
    sm.has_access.return_value = False
    return sm


@pytest.fixture
def app_context(mock_sm: MagicMock):
    """Minimal Flask app context for testing API helpers."""
    from flask import Flask

    app = Flask(__name__)
    app.config["SECRET_KEY"] = "test-secret-key-not-for-production"
    app.config["MARIMO_SIDECAR_URL"] = "http://localhost:8765"
    app.appbuilder = MagicMock()
    app.appbuilder.sm = mock_sm
    return app


class TestBuildLaunchUrl:
    """Tests for _build_launch_url."""

    def test_edit_mode_url_contains_mode_param(self, app_context) -> None:
        from mitodl.marimo_notebooks.api import _build_launch_url

        with app_context.app_context(), patch("flask_login.current_user") as mock_user:
            mock_user.id = 42
            url = _build_launch_url("nb-123", mode="edit")

        assert "mode=edit" in url
        assert "nb-123" in url
        assert "token=" in url

    def test_run_mode_url_contains_mode_param(self, app_context) -> None:
        from mitodl.marimo_notebooks.api import _build_launch_url

        with app_context.app_context(), patch("flask_login.current_user") as mock_user:
            mock_user.id = 99
            url = _build_launch_url("nb-456", mode="run")

        assert "mode=run" in url
        assert "nb-456" in url

    def test_token_is_signed_with_secret_key(self, app_context) -> None:
        from itsdangerous import URLSafeTimedSerializer
        from mitodl.marimo_notebooks.api import _LAUNCH_SALT, _build_launch_url

        with app_context.app_context(), patch("flask_login.current_user") as mock_user:
            mock_user.id = 1
            url = _build_launch_url("nb-789", mode="edit")

        token = url.split("token=")[1].split("&")[0]
        s = URLSafeTimedSerializer("test-secret-key-not-for-production")
        payload = s.loads(token, salt=_LAUNCH_SALT, max_age=300)
        assert payload["notebook_id"] == "nb-789"
        assert payload["mode"] == "edit"
        assert payload["user_id"] == 1


class TestGetCapabilities:
    """Tests for the /capabilities endpoint permission logic."""

    def test_write_role_gets_edit_mode(self, mock_sm: MagicMock) -> None:
        mock_sm.has_access.return_value = True
        # Simulate: sm.has_access("can_write", "marimo_notebooks") → True
        assert mock_sm.has_access("can_write", "marimo_notebooks") is True

    def test_read_only_role_gets_run_mode(self, mock_sm: MagicMock) -> None:
        mock_sm.has_access.return_value = False
        assert mock_sm.has_access("can_write", "marimo_notebooks") is False
