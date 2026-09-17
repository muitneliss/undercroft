"""The control plane application.

Serves ``/api/*`` and, at every other path, the built SPA. A single-page app owns
its own routing, so any unknown path must return ``index.html`` rather than 404 --
otherwise the app works until someone reloads the page they are on.

**Money never leaves here as a number**; see :mod:`vcdo.api.models` for why an
encoder is not sufficient to guarantee that and what is done instead.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

from vcdo.api.routers import auth, connections, lake, oauth, tenants, users

__all__ = ["create_app", "app"]

#: Where the built SPA lands in the image. Overridable so the API can run against
#: a Vite dev server during development without a build step.
STATIC_DIR = Path(os.environ.get("VCDO_UI_DIST", "/app/ui/dist"))


def create_app() -> FastAPI:
    application = FastAPI(
        title="VietCham control plane",
        # No docs in production: this schema describes every endpoint that can
        # mint a customer's OAuth token, and it is served on a public domain.
        docs_url="/api/docs" if os.environ.get("VCDO_API_DOCS") == "1" else None,
        redoc_url=None,
    )

    for module in (auth, tenants, connections, oauth, lake, users):
        application.include_router(module.router)

    @application.get("/api/health")
    def health() -> dict:
        """Unauthenticated, and deliberately shallow.

        Says this process is up. It does NOT check Postgres, because a
        healthcheck that fails when a dependency is briefly unavailable gets the
        container restarted, which fixes nothing and loses the in-flight
        requests. `vcdo doctor` is the deep check.
        """
        return {"status": "ok"}

    @application.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        """The type, never the message.

        Same discipline as the worker's trigger: exception text routinely embeds
        the offending row, and this response goes to a browser.
        """
        return JSONResponse(status_code=500, content={"error_type": type(exc).__name__})

    @application.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        """Serve the SPA, or a real asset if that is what was asked for."""
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="not found")

        asset = (STATIC_DIR / full_path).resolve()
        # Resolved and then checked to be inside the root: `..` in a URL path is
        # otherwise a file read of anything the process can open.
        if full_path and STATIC_DIR.resolve() in asset.parents and asset.is_file():
            return FileResponse(asset)

        index = STATIC_DIR / "index.html"
        if not index.is_file():
            raise HTTPException(
                status_code=503,
                detail="the UI has not been built; run `make ui-build`",
            )
        return FileResponse(index)

    return application


app = create_app()
