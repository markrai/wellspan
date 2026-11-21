# LOBO label auto-populate

This editable-draft integration uses the existing browser-to-Workbench lobo.handoff/v1 protocol, not a new server endpoint or PACK gateway.

1. Open Add/Edit Food. Wellspan checks Vega's read-only `/api/v1/lobo/devices` discovery endpoint. If one phone is advertised and no phone has been saved, it suggests that phone. If several are advertised, select a device from the Nearby LOBO devices dropdown. A previously verified LOBO identity takes priority, even if DHCP changed its IP. The last verified HTTPS origin remains a fallback when discovery is unavailable. You can always edit the HTTPS origin manually; a manual entry is not overwritten while the dialog is open. Provide one PNG/JPEG/WebP label (1 byte to 5 MiB) using **Choose file**, drag and drop into the image area, Ctrl+V / ⌘V while the dialog is focused outside editable text fields, or **Paste image** when the browser permits clipboard access. All methods share one preview and validation.
2. Select Extract with LOBO. A previously trusted website-and-Recipe pair runs without additional authorization; otherwise authorize the built-in nutrition-label-facts Recipe in the Workbench.
3. Wellspan validates the lobo.extract.report/v1 response and renders source evidence for each returned nutrient. A serving-weight quote may omit the word serving when it is contained in a separate, matched printed serving description; the gram amount must still match exactly. Invalid or unsupported reports never change editor values. If a source-matched number appears in an optional nutrient's quote but the quote fails to identify the nutrient (for example, a bare `0mg` rather than `Sodium 0mg`), that single nutrient is quarantined and explicitly marked **Not imported (ambiguous quote)**. Other verified values can still fill the editor. Rejected extractions, skipped-nutrient messages and skipped values in the evidence table are shown in red, with an assertive accessibility alert for status errors. Required-field failures, numeric mismatches, unsupported evidence and malformed reports remain blocking errors.
4. As soon as a valid report is returned, Wellspan fills **all valid extracted nutrient fields** in the food editor automatically, including replacing existing values for those nutrients. Missing nutrients remain unchanged; there is no additional approval checkbox, per-nutrient selection or Apply button.
5. Review the photo, printed serving and source evidence. Correct the editable nutrient fields to reflect the portion you normally eat. Auto-population changes only the form, not persistent state. Save Food is a separate user action under normal IndexedDB/Vega revision controls.

Wellspan stores only the canonical last connected Workbench origin and selected LOBO service identity in the browser's localStorage, after a verified handoff. It does not persist a bearer, source image or extraction result. The browser cannot enumerate mDNS; a separate, narrowly scoped systemd helper on Vega's LAN reads `_lobo._tcp` advertisements through Avahi and writes short-lived JSON into `/var/lib/wellspan-lobo/devices.json`. The existing Docker staging deployment mounts this directory **read-only** as `/discovery` only when the host helper has been installed. The Go server serves validated, at-most-45-second-old candidates over the same-origin GET endpoint without performing network discovery or fetching device URLs itself. An advertisement is not an authentication or reachability signal. Browser certificate trust, network reachability, Workbench origin verification and LOBO approval are still required. Remote Tailscale clients may not reach an advertised private LAN address. The requester waits up to 90 seconds for the Workbench to connect, then up to 15 minutes for a confirmed Recipe result. LOBO bounds one Recipe run at 10 minutes; preparation and review may add time. Wellspan distinguishes a connection timeout from a missing result and shows a diagnostic for a correctly authenticated result envelope that fails validation. A result arriving after expiry is refused; the client does not retry or save automatically.

Changing the selected image cancels the prior handoff listener, clears its review and revokes the old preview URL. The Paste image button may require clipboard permission; keyboard paste and Choose file remain available if permission is denied. Pasting into text fields behaves normally. No image, report or serving metadata is persisted in the Foodboard. The label image URL is revoked when closing the dialog. Rejected, malformed, expired or declined handoffs fail closed. A cancelled handoff only stops listening, not work already running on the phone. No automatic scaling or guessed values are allowed. Evidence matching is not proof of nutritional accuracy and the phone's raw OCR transcript is not available in M3. Review the original label before saving.

Acceptance: exercise picker, drop and both clipboard mechanisms; invalid type/size; multi-image and text-only paste; dialog reset and preview cleanup; supported/unsupported fixtures; perform a real phone run with the updated Android Workbench, verify immediate editable draft population and no checkbox/Apply button, verify no write before Save Food, verify null preservation, cancel/close behavior, and offline synchronization. If Android still produces arrays, it must refuse them rather than convert quoted numbers.


## Enable actual mDNS discovery on Vega

LOBO already registers `_lobo._tcp` with a stable `LOBO-XXXXXX` instance name, its private IPv4 address and HTTPS Workbench port. Ordinary browser JavaScript cannot access LAN mDNS directly.

On the **Vega Ubuntu host**, install Avahi if needed, then install the restricted host discovery timer:

```bash
sudo apt-get install avahi-daemon avahi-utils python3
sudo bash scripts/install-lobo-discovery.sh
sudo systemctl status wellspan-lobo-discovery.timer
sudo cat /var/lib/wellspan-lobo/devices.json
```

Then deploy Wellspan again using the existing tested staging script:

```bash
./deploy.sh
curl -fsS http://127.0.0.1:18788/api/v1/lobo/devices
```

The helper periodically runs `avahi-browse --resolve --parsable --terminate _lobo._tcp` through the host's Avahi service. It accepts only valid LOBO names, IPv4 RFC1918 LAN endpoints and `proto=1/path=/v1` TXT records, and produces an atomic, size-limited candidate list. Android's Avahi-resolved hostnames can contain underscores (for example `Android_P81IFKSA.local`); the Python helper, Go API and browser validator preserve these hostnames while maintaining the existing service and address restrictions. Systemd runs it with no Linux capabilities and constrained filesystem access. Wellspan's container retains its loopback-only HTTP port, read-only filesystem, dropped capabilities and unchanged SQLite volume.

The snapshot is optional: a missing helper, stale JSON or unavailable mDNS returns `{"status":"unavailable","devices":[]}`; manual entry and the last verified URL remain functional. Installing the host timer alone does **not** modify a running container's mounts; rerun `./deploy.sh` afterward. Discovery is the LAN view from Vega; it does not guarantee that a remote browser can open `https://phone:7869`, or that the phone's CA is trusted on that browser.

For device/IP changes, reopen Add/Edit Food or click **Refresh**. The previously connected device identity is preferred when it appears at a new address. Never treat the discovery list as proof of identity; only a browser-verified HTTPS handoff with a known LOBO Recipe and an explicit user review can apply values. Manual overrides stay available.
