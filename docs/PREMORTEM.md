# Pre-mortem — why Warden32 could die (and the fixes already in place)

Premise (owner-requested): assume Warden32 shipped and is already dead. Autopsy
of the five most likely causes, each with early warning signs and the
mitigation baked into this repo.

## 1. Trust collapse — "the simulator lied"

Cause: results looked authoritative but drifted from real hardware (guessed ACL
semantics, fake-looking counters, features stock hardware lacks). Papers and
users caught it; the tool became a citation liability.

Warnings: any number without provenance; any "blocked" label on L2-relayed
traffic; screenshots implying capabilities stock firmware doesn't have.

Fixes (already law): provenance tags on every datum
(measured | datasheet | paper | estimate | assumption); `not enforceable`
labels; `not implemented on hardware` labels for hypothetical profiles;
`docs/VERIFIED-FACTS.md` + calibration import.

## 2. Scope creep — never finished

Cause: 12 pages, attack lab, registry, reports, paper, firmware — v1 slipped
forever; the builder burned out; the repo fossilized at 40 %.

Warnings: any milestone in progress for weeks; new features added during
M1–M3 (scope is frozen in §4).

Fixes: milestone plan §21 executed in order; thin vertical slices; this repo
shipped M1 before M2 exists; every feature has a test story before it starts.

## 3. Performance death — the tab froze

Cause: UI re-rendered on every event; 10⁴-packet floods locked the browser;
users rage-quit and never returned.

Warnings: engine work on the UI thread; unbounded event arrays; FPS drops
during scan sweeps.

Fixes: engine is pure and headless (Web Worker move in M2); bounded logs with
caps; virtual clock; performance budget in tests; no ambient animation.

## 4. Portability failure — labs trapped

Cause: projects in IndexedDB only; no export; a cleared cache or a new laptop
lost everything; teachers couldn't collect labs; sharing impossible.

Warnings: "works on my machine"; any lab state you can't re-import from a file.

Fixes: single-file `.warden32` (human-readable JSON, checksum, schema version);
import → preview → confirm; drag-and-drop open/save; autosave + crash recovery.

## 5. Ecosystem death / abandonment

Cause: hardcoded devices/protocols; the community couldn't add anything; when
the builder's attention moved, nothing kept it alive (see the abandoned
projects in `MARKET-RESEARCH.md`).

Warnings: any new device requiring engine code changes; no schemas; no
example extensions; no CONTRIBUTING.

Fixes: extension registry + JSON schemas + `docs/EXTENDING.md` (data entries,
not code); docs-first repo; CI (install → lint → typecheck → test → build);
issue/PR templates; Apache-2.0.

## Kill-switch checks (run each milestone)

- Can a stranger reproduce your last result from one file? (must be yes)
- Is any number on screen lacking provenance? (must be no)
- Was the engine ever on the UI thread? (must be no)
- Can a new device be added without touching engine code? (demo it)
