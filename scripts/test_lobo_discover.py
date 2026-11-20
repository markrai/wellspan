import json
import tempfile
import unittest
from pathlib import Path

from lobo_discover import parse_line, parse_results, write_snapshot


def entry(name="LOBO-8207D3", address="192.168.1.200", txt='"proto=1" "path=/v1"'):
    return f"=;eth0;IPv4;{name};_lobo._tcp;local;lobo.local;{address};7869;{txt}"


class DiscoveryTest(unittest.TestCase):
    def test_supported_mdns_record(self):
        self.assertEqual(parse_line(entry()), {
            "id": "LOBO-8207D3", "host": "lobo.local", "address": "192.168.1.200",
            "port": 7869, "proto": "1", "path": "/v1",
        })
        self.assertEqual(parse_line(entry(name="LOBO-8207D3 (2)"))["id"], "LOBO-8207D3 (2)")

    def test_ignore_non_lobo_and_unsafe_records(self):
        for row in [
            entry(name="other"), entry(address="8.8.8.8"), entry(address="127.0.0.1"),
            entry(address="169.254.1.2"), entry(txt='"proto=2" "path=/v1"'),
            entry(txt='"proto=1" "path=/admin"'), entry().replace(";7869;", ";0;"),
            entry().replace(";IPv4;", ";IPv6;"), entry().replace(";local;", ";example;"),
            entry().replace(";lobo.local;", ";not-local.example;"),
            entry().replace(";_lobo._tcp;", ";_other._tcp;"),
            entry().replace(";192.168.1.200;", ";192.168.1.200;") + ";extra"
        ][:-1]:
            self.assertIsNone(parse_line(row), row)

    def test_duplicates_and_deterministic_sort(self):
        output = "\n".join([entry(name="LOBO-FFFFFF"), entry(), entry(), entry(name="invalid")])
        self.assertEqual([item["id"] for item in parse_results(output)], ["LOBO-8207D3", "LOBO-FFFFFF"])

    def test_atomic_snapshot_has_timestamp_and_secure_file_mode(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "devices.json"
            write_snapshot(path, parse_results(entry()))
            data = json.loads(path.read_text())
            self.assertEqual(data["devices"][0]["id"], "LOBO-8207D3")
            self.assertTrue(data["generatedAt"].endswith("Z"))
            self.assertEqual(path.stat().st_mode & 0o777, 0o644)


if __name__ == "__main__":
    unittest.main()
