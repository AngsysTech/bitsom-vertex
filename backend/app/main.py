"""FastAPI app. Plain JSON, no auth, no streaming. Errors are {error: string}.

Run from backend/:  .venv/bin/uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import coach as coach_api
from app.api import companion as companion_api
from app.api import demo as demo_api
from app.api import mindmap as mindmap_api
from app.tools.companion import BadRequest, NotFound

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Student Workspace API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(companion_api.router)
app.include_router(coach_api.router)
app.include_router(demo_api.router)
app.include_router(mindmap_api.router)


@app.exception_handler(NotFound)
async def _not_found(_: Request, exc: NotFound) -> JSONResponse:
    return JSONResponse({"error": str(exc)}, status_code=404)


@app.exception_handler(BadRequest)
async def _bad_request(_: Request, exc: BadRequest) -> JSONResponse:
    return JSONResponse({"error": str(exc)}, status_code=400)


@app.exception_handler(StarletteHTTPException)
async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse({"error": str(exc.errors())[:500]}, status_code=422)


@app.exception_handler(Exception)
async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
    logging.getLogger("api").exception("unhandled error")
    return JSONResponse({"error": f"internal error: {type(exc).__name__}"}, status_code=500)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
