#!/usr/bin/env python3
"""Small, dependency-free CLI for Doco document and attachment APIs."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


SKILL_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = SKILL_DIR / "config.env"


def load_config(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.exists():
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    for key in ("DOCO_BASE_URL", "DOCO_API_TOKEN"):
        if os.environ.get(key):
            values[key] = os.environ[key]
    missing = [key for key in ("DOCO_BASE_URL", "DOCO_API_TOKEN") if not values.get(key)]
    if missing:
        raise SystemExit(f"Missing configuration: {', '.join(missing)}")
    return values


class DocoApiError(RuntimeError):
    """Preserve HTTP status and the complete API error envelope for callers."""

    def __init__(self, status: int, body: object):
        self.status = status
        self.body = body
        error = body.get("error", {}) if isinstance(body, dict) else {}
        self.code = error.get("code")
        self.details = error.get("details")
        super().__init__(json.dumps({"status": status, "body": body}, ensure_ascii=False))


class DocoClient:
    def __init__(self, base_url: str, token: str, timeout: int = 45):
        base = base_url.rstrip("/")
        self.origin = base[:-7] if base.endswith("/api/v1") else base
        self.api_root = base if base.endswith("/api/v1") else f"{base}/api/v1"
        self.token = token
        self.timeout = timeout

    def request(
        self,
        method: str,
        path: str,
        *,
        body: object | None = None,
        raw_body: bytes | None = None,
        headers: dict[str, str] | None = None,
        api: bool = True,
    ) -> dict[str, object]:
        root = self.api_root if api else self.origin
        url = f"{root}{path}"
        request_headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
            "User-Agent": "Doco-Agent/documents-skill/1.0 (+https://doco.page/api-docs)",
        }
        request_headers.update(headers or {})
        data = raw_body
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            request_headers.setdefault("Content-Type", "application/json")
        request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = response.read()
                parsed: object = None
                if payload:
                    content_type = response.headers.get("Content-Type", "")
                    parsed = json.loads(payload) if "json" in content_type else payload.decode("utf-8", "replace")
                return {
                    "status": response.status,
                    "etag": response.headers.get("ETag"),
                    "request_id": response.headers.get("X-Request-Id"),
                    "body": parsed,
                }
        except urllib.error.HTTPError as error:
            payload = error.read()
            try:
                parsed = json.loads(payload) if payload else None
            except json.JSONDecodeError:
                parsed = payload.decode("utf-8", "replace")
            raise DocoApiError(error.code, parsed) from None
        except urllib.error.URLError as error:
            raise RuntimeError(f"Network error: {error.reason}") from None

    def get_spreadsheet(self, document_id: str) -> dict[str, object]:
        return self.request("GET", f"/documents/{urllib.parse.quote(document_id, safe='')}/spreadsheet")

    def get_cells(self, document_id: str, sheet_id: str, range: str) -> dict[str, object]:
        query = urllib.parse.urlencode({"range": range})
        return self.request("GET", f"/documents/{urllib.parse.quote(document_id, safe='')}/spreadsheet/sheets/{urllib.parse.quote(sheet_id, safe='')}/cells?{query}")

    def update_cells(self, document_id: str, sheet_id: str, cells: dict[str, str], etag: str) -> dict[str, object]:
        if not isinstance(etag, str) or not etag.strip() or etag.strip() == "*":
            raise ValueError("update_cells requires a concrete document version / ETag")
        version = etag.strip()
        if not version.startswith('"'):
            version = f'"{version}"'
        return self.request(
            "PATCH",
            f"/documents/{urllib.parse.quote(document_id, safe='')}/spreadsheet/sheets/{urllib.parse.quote(sheet_id, safe='')}/cells",
            body={"cells": cells}, headers={"If-Match": version},
        )

    def current_etag(self, document_id: str) -> str:
        result = self.request("GET", f"/documents/{urllib.parse.quote(document_id)}/content?format=tiptap-json")
        etag = result.get("etag")
        if not isinstance(etag, str) or not etag:
            raise RuntimeError("Doco did not return an ETag for the document")
        return etag


def read_json_file(path: str) -> object:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def multipart_attachment(document_id: str, file_path: Path) -> tuple[bytes, str]:
    boundary = f"----doco-{uuid.uuid4().hex}"
    mime = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    chunks = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"document_id\"\r\n\r\n{document_id}\r\n".encode(),
        (
            f"--{boundary}\r\n"
            f"Content-Disposition: form-data; name=\"file\"; filename=\"{file_path.name}\"\r\n"
            f"Content-Type: {mime}\r\n\r\n"
        ).encode(),
        file_path.read_bytes(),
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def add_position_arguments(parser: argparse.ArgumentParser) -> None:
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--after-block-id")
    group.add_argument("--before-block-id")
    group.add_argument("--parent-block-id")
    group.add_argument("--document-start", action="store_true")
    group.add_argument("--document-end", action="store_true")
    parser.add_argument("--child-index", type=int)


def position_from_args(args: argparse.Namespace) -> dict[str, object]:
    if args.after_block_id:
        return {"after_block_id": args.after_block_id}
    if args.before_block_id:
        return {"before_block_id": args.before_block_id}
    if args.parent_block_id:
        value: dict[str, object] = {"parent_block_id": args.parent_block_id}
        if args.child_index is not None:
            value["child_index"] = args.child_index
        return value
    if args.document_start:
        return {"document_start": True}
    return {"document_end": True}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Read and write Doco documents through Open API")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("me")
    sub.add_parser("schema")

    get_doc = sub.add_parser("get-document")
    get_doc.add_argument("document_id")

    spreadsheet = sub.add_parser("get-spreadsheet")
    spreadsheet.add_argument("document_id")
    cells = sub.add_parser("get-cells")
    cells.add_argument("document_id")
    cells.add_argument("sheet_id")
    cells.add_argument("--range", required=True)
    update_cells = sub.add_parser("update-cells")
    update_cells.add_argument("document_id")
    update_cells.add_argument("sheet_id")
    update_cells.add_argument("--file", required=True, help='JSON address-to-string map, e.g. {"C15":"10"}')
    update_cells.add_argument("--etag", required=True, help="Document version / quoted ETag read before writing")

    get_content = sub.add_parser("get-content")
    get_content.add_argument("document_id")
    get_content.add_argument("--format", choices=("tiptap-json", "markdown", "html"), default="tiptap-json")

    blocks = sub.add_parser("list-blocks")
    blocks.add_argument("document_id")
    blocks.add_argument("--recursive", action="store_true")

    create_doc = sub.add_parser("create-document")
    create_doc.add_argument("--file", required=True, help="JSON request body")
    create_doc.add_argument("--idempotency-key")

    update_doc = sub.add_parser("update-document")
    update_doc.add_argument("document_id")
    update_doc.add_argument("--file", required=True, help="JSON request body")

    put_content = sub.add_parser("put-content")
    put_content.add_argument("document_id")
    put_content.add_argument("--file", required=True, help="JSON ContentInput body")
    put_content.add_argument("--etag", required=True)

    insert_blocks = sub.add_parser("insert-blocks")
    insert_blocks.add_argument("document_id")
    insert_blocks.add_argument("--file", required=True, help="JSON with position and nodes")
    insert_blocks.add_argument("--etag", help="Defaults to a fresh content ETag")

    upload = sub.add_parser("upload-attachment")
    upload.add_argument("document_id")
    upload.add_argument("file")
    upload.add_argument("--idempotency-key")

    image = sub.add_parser("insert-image")
    image.add_argument("document_id")
    image.add_argument("attachment_id")
    add_position_arguments(image)
    image.add_argument("--alt")
    image.add_argument("--title")
    image.add_argument("--width", type=int)
    image.add_argument("--height", type=int)
    image.add_argument("--align", choices=("left", "center", "right"), default="center")
    image.add_argument("--etag", help="Defaults to a fresh content ETag")

    patch = sub.add_parser("patch-block")
    patch.add_argument("document_id")
    patch.add_argument("block_id")
    patch.add_argument("--file", required=True, help="JSON with node, attrs, or content")
    patch.add_argument("--etag", help="Defaults to a fresh content ETag")

    return parser


def main() -> int:
    args = build_parser().parse_args()
    config = load_config(Path(args.config).expanduser())
    client = DocoClient(config["DOCO_BASE_URL"], config["DOCO_API_TOKEN"])
    command = args.command

    if command == "me":
        result = client.request("GET", "/me")
    elif command == "schema":
        result = client.request("GET", "/api/openapi.json", api=False)
    elif command == "get-document":
        result = client.request("GET", f"/documents/{urllib.parse.quote(args.document_id)}")
    elif command == "get-spreadsheet":
        result = client.get_spreadsheet(args.document_id)
    elif command == "get-cells":
        result = client.get_cells(args.document_id, args.sheet_id, args.range)
    elif command == "update-cells":
        result = client.update_cells(args.document_id, args.sheet_id, read_json_file(args.file), args.etag)
    elif command == "get-content":
        query = urllib.parse.urlencode({"format": args.format})
        result = client.request("GET", f"/documents/{urllib.parse.quote(args.document_id)}/content?{query}")
    elif command == "list-blocks":
        query = urllib.parse.urlencode({"recursive": "true" if args.recursive else "false"})
        result = client.request("GET", f"/documents/{urllib.parse.quote(args.document_id)}/blocks?{query}")
    elif command == "create-document":
        headers = {"Idempotency-Key": args.idempotency_key} if args.idempotency_key else {}
        result = client.request("POST", "/documents", body=read_json_file(args.file), headers=headers)
    elif command == "update-document":
        result = client.request("PATCH", f"/documents/{urllib.parse.quote(args.document_id)}", body=read_json_file(args.file))
    elif command == "put-content":
        result = client.request(
            "PUT",
            f"/documents/{urllib.parse.quote(args.document_id)}/content",
            body=read_json_file(args.file),
            headers={"If-Match": args.etag},
        )
    elif command == "insert-blocks":
        etag = args.etag or client.current_etag(args.document_id)
        result = client.request(
            "POST",
            f"/documents/{urllib.parse.quote(args.document_id)}/blocks",
            body=read_json_file(args.file),
            headers={"If-Match": etag},
        )
    elif command == "upload-attachment":
        file_path = Path(args.file).expanduser().resolve()
        if not file_path.is_file():
            raise SystemExit(f"File not found: {file_path}")
        raw_body, content_type = multipart_attachment(args.document_id, file_path)
        headers = {"Content-Type": content_type}
        if args.idempotency_key:
            headers["Idempotency-Key"] = args.idempotency_key
        result = client.request("POST", "/attachments", raw_body=raw_body, headers=headers)
    elif command == "insert-image":
        attrs = {
            "attachmentId": args.attachment_id,
            "alt": args.alt,
            "title": args.title,
            "width": args.width,
            "height": args.height,
            "align": args.align,
        }
        body = {"position": position_from_args(args), "nodes": [{"type": "image", "attrs": attrs}]}
        etag = args.etag or client.current_etag(args.document_id)
        result = client.request(
            "POST",
            f"/documents/{urllib.parse.quote(args.document_id)}/blocks",
            body=body,
            headers={"If-Match": etag},
        )
    elif command == "patch-block":
        etag = args.etag or client.current_etag(args.document_id)
        result = client.request(
            "PATCH",
            f"/documents/{urllib.parse.quote(args.document_id)}/blocks/{urllib.parse.quote(args.block_id)}",
            body=read_json_file(args.file),
            headers={"If-Match": etag},
        )
    else:
        raise AssertionError(command)

    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
