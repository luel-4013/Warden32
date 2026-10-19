# Security Policy

## Scope

Warden32 is an offline, deterministic simulation of an ESP32 IoT
firewall/NAT router. It ships as static files produced by the Vite build
(`dist/`); there is no server, no account system, and no network service. The
engine simulates flows in memory only — the application performs no network
I/O and never generates real traffic, scans or attacks.

That removes most classic attack surface, but the following is genuinely in
scope:

- **XSS or script injection via imported files** — a crafted `.warden32`
  project or `.warden32.calibration` whose field values attempt to break out
  of the UI and execute script.
- **Malicious or malformed project JSON** — input designed to corrupt state,
  bypass the validator, cause incorrect verdicts, or degrade the UI.
- **Supply chain** — vulnerabilities in shipped npm dependencies.

Out of scope: issues that require the app to make network requests (it does
not), and findings that amount to the simulation behaving as simulated.

## How project files are validated

Imports go through `parseProject` in `src/storage/project.ts`:

1. The text must parse as JSON, be an object, declare schema
   `warden32.project`, carry a supported (not newer) `schemaVersion`, and
   contain a `project` payload object.
2. An FNV-1a checksum is recomputed over canonicalized JSON and compared with
   the embedded `checksum`; a mismatch rejects the file as possibly corrupted.
   The `skipChecksum` recovery path exists for damaged files and records a
   warning instead.
3. `validateProject` then checks the payload structurally: unique zone,
   interface, device, rule and route ids; valid IPv4 addresses, prefixes and
   CIDR; DHCP pools inside their interface subnet; device and route
   cross-references; port ranges; port-forward targets; allowed enum values
   for dialects, egress policies and behaviour states; positive resource
   bounds. Errors reject the import; warnings are surfaced to the user.

No field from an imported file is executed — it is data only. The codebase
contains no `dangerouslySetInnerHTML`, `eval` or dynamic code execution, and
imported values are rendered through React's default escaping.

Calibration files go through `parseCalibration` in `src/engine/calibration.ts`
with a strict `kind`/`version`/metric allowlist; unknown metrics and invalid
values are rejected. If you find a gap in either validator, that is a valid
report.

## Reporting a vulnerability

Use the repository's **Security tab → "Report a vulnerability"** to open a
GitHub private security advisory. There is no security email address; please
do not send reports by email and do not open a public issue for an
exploitable problem before a fix is available.

Include:

- Package version (`0.1.0`) and engine version (`0.2.0`) if known.
- A minimal reproduction: the malicious project file or the exact steps.
- The impact you believe it has.

This is a maintainer-run research project with no SLA; reports are handled on
a best-effort basis. Supported versions: the current `main` branch only —
Warden32 is pre-release.

## Responsible use

The attack scenarios in this lab exist only inside the simulation, for
defensive security research on hardware and networks you own or are
authorised to test.

- Do not use techniques modelled or described here against networks you do
  not own or have explicit permission to test.
- The tool intentionally models weaknesses — for example, guest-to-guest
  Wi-Fi traffic that the stock firmware cannot filter (`not enforceable`) —
  so that defenders can see and fix them. Modelling a weakness is not an
  endorsement of attacking it.
- Results are simulated unless explicitly measured on real hardware and
  imported as calibration; do not present simulated output as hardware
  evidence.
