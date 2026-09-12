import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location("doco_api", Path(__file__).resolve().parents[1] / "scripts/doco_api.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


class SpreadsheetTests(unittest.TestCase):
    def setUp(self):
        self.client = api.DocoClient("http://localhost/api/v1", "test-token")
        self.cells = {"C15": "10", "C16": "20", "C17": "=SUM(C15:C16)", "C18": ""}

    def test_request_paths_and_version(self):
        with patch.object(self.client, "request", return_value={"body": {"data": {"cells": self.cells}}}) as request:
            self.client.get_spreadsheet("doc/1")
            request.assert_called_with("GET", "/documents/doc%2F1/spreadsheet")
            self.client.get_cells("doc/1", "sheet/1", "C15:C18")
            request.assert_called_with("GET", "/documents/doc%2F1/spreadsheet/sheets/sheet%2F1/cells?range=C15%3AC18")
            for etag in ["old", '"old"']:
                result = self.client.update_cells("doc/1", "sheet/1", self.cells, etag)
                request.assert_called_with("PATCH", "/documents/doc%2F1/spreadsheet/sheets/sheet%2F1/cells", body={"cells": self.cells}, headers={"If-Match": '"old"'})
                self.assertEqual(result["body"]["data"]["cells"], self.cells)
            for etag in [None, "", " ", "*"]:
                with self.assertRaises(ValueError):
                    self.client.update_cells("doc", "sheet_1", self.cells, etag)
            self.assertEqual(request.call_count, 4)

    def test_http_errors_preserve_status_code_details_without_retry(self):
        for status, code in [(409, "document_version_conflict"), (409, "document_type_mismatch"), (400, "invalid_spreadsheet_range"), (404, "spreadsheet_sheet_not_found")]:
            body = {"error": {"code": code, "details": {"current_version": "new"}}, "request_id": "req-test"}
            error = urllib.error.HTTPError("http://localhost", status, "failed", {}, io.BytesIO(json.dumps(body).encode()))
            with patch.object(api.urllib.request, "urlopen", side_effect=error) as send:
                with self.assertRaises(api.DocoApiError) as caught:
                    self.client.update_cells("doc", "sheet_1", self.cells, "old")
                self.assertEqual(caught.exception.status, status)
                self.assertEqual(caught.exception.code, code)
                self.assertEqual(caught.exception.details["current_version"], "new")
                self.assertEqual(json.loads(str(caught.exception))["body"], body)
                self.assertEqual(send.call_count, 1)
                req = send.call_args.args[0]
                self.assertEqual(req.get_header("Authorization"), "Bearer test-token")
                self.assertEqual(req.get_header("If-match"), '"old"')
                self.assertEqual(json.loads(req.data), {"cells": self.cells})

    def test_cli_routes(self):
        cases = [("get-spreadsheet", ["doc"], "get_spreadsheet"), ("get-cells", ["doc", "sheet_1", "--range", "C15:C18"], "get_cells"), ("update-cells", ["doc", "sheet_1", "--file", "cells.json", "--etag", "old"], "update_cells")]
        for command, args, method in cases:
            with patch.object(api, "load_config", return_value={"DOCO_BASE_URL": "http://localhost", "DOCO_API_TOKEN": "test"}), patch.object(api, "read_json_file", return_value=self.cells), patch.object(api.DocoClient, method, return_value={"status": 200}) as call, patch.object(api.sys, "stdout", new_callable=io.StringIO):
                with patch.object(api.sys, "argv", ["doco_api.py", command, *args]):
                    self.assertEqual(api.main(), 0)
                self.assertEqual(call.call_count, 1)


if __name__ == "__main__":
    unittest.main()
