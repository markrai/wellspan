#!/usr/bin/env python3
import argparse
import ipaddress
import json
import os
import re
import shlex
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SERVICE_TYPE = "_lobo._tcp"
NAME = re.compile(r"^LOBO-[0-9A-F]{6}(?: \([2-9][0-9]*\))?$")
LAN_RANGES = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
)
MAX_DEVICES = 16


def parse_line(line):
    parts = line.strip().split(";")
    if len(parts) < 10 or parts[0] != "=" or parts[2] != "IPv4":
        return None
    _, interface, _, name, service, domain, host, address, port, *txt = parts
    if service != SERVICE_TYPE or domain != "local" or not NAME.fullmatch(name):
        return None
    if not re.fullmatch(r"[a-zA-Z0-9.-]{1,253}", host) or not host.endswith(".local"):
        return None
    try:
        ip = ipaddress.IPv4Address(address)
        if not any(ip in network for network in LAN_RANGES):
            return None
        port_number = int(port)
        if not 1 <= port_number <= 65535:
            return None
        records = shlex.split(";".join(txt))
        attributes = dict(record.split("=", 1) for record in records if "=" in record)
    except (ValueError, TypeError):
        return None
    if attributes.get("proto") != "1" or attributes.get("path") != "/v1":
        return None
    return {
        "id": name,
        "host": host,
        "address": str(ip),
        "port": port_number,
        "proto": "1",
        "path": "/v1",
    }


def parse_results(output):
    devices = {}
    for line in output.splitlines():
        entry = parse_line(line)
        if entry:
            devices.setdefault(entry["id"], entry)
    return [devices[key] for key in sorted(devices)[:MAX_DEVICES]]


def scan():
    result = subprocess.run(
        ["avahi-browse", "--resolve", "--parsable", "--terminate", SERVICE_TYPE],
        capture_output=True, text=True, check=True, timeout=12
    )
    if len(result.stdout) > 65536:
        raise ValueError("Discovery output exceeded limit")
    return parse_results(result.stdout)


def write_snapshot(destination, devices):
    destination = Path(destination)
    if not destination.parent.is_dir():
        raise OSError("Discovery state directory is missing")
    snapshot = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "devices": devices,
    }
    descriptor, temporary = tempfile.mkstemp(dir=destination.parent, prefix=".lobo-", text=True)
    try:
        os.fchmod(descriptor, 0o644)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(snapshot, stream, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    write_snapshot(args.output, scan())


if __name__ == "__main__":
    main()
