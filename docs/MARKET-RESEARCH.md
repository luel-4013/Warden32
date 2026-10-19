# Market research — why network/IoT simulation products win or die

Fetched 2026-10-18. The `websearch`/`webfetch` tools were unavailable in this
environment, so data was retrieved with direct `curl` calls to stable endpoints
(GitHub REST API, Wikipedia). Every claim is either (a) fetched with a dated
URL, or (b) explicitly marked as synthesis from known community discourse.

## Fetched signals

### Open-source traction (api.github.com, 2026-10-18)

| Project | stars | open issues | last push | license | one-liner |
|---|---|---|---|---|---|
| containerlab | 2 885 | 53 | 2026-10-18 | BSD-3 | container-based network topologies |
| GNS3 (GUI) | 2 653 | 117 | 2026-10-02 | GPL-3 | graphical network emulator |
| Shadow | 1 732 | — | 2026-10-15 | — | discrete-event network simulator |
| Batfish | 1 504 | 286 | 2026-10-18 | Apache-2.0 | config analysis / validation |
| netlab | 750 | 31 | 2026-10-15 | (see repo) | declarative multi-vendor labs |
| Kathara | 651 | 17 | 2026-10-15 | GPL-3 | container network emulation |

Fetched: `https://api.github.com/search/repositories?q=network+simulator…`,
`…/q=iot+simulator…`, `https://api.github.com/repos/<owner>/<repo>`.

The IoT-simulator category is fragmented and mostly stale — vendor starter
kits dominate; e.g. Microsoft CounterFit (241★, archived 2023-03), SAP IoT
starterkit (274★, pushed 2021), IBA IoT-data-simulator (125★, pushed 2020).

### Wikipedia (direct fetch)

- **Cisco Packet Tracer** — free for NetAcad accounts only; "intended … only
  as a learning aid, not a replacement for Cisco routers and switches"; "only
  has a small number of features" (en.wikipedia.org/wiki/Cisco_Packet_Tracer).
- **GNS3** — used by Exxon, Walmart, AT&T, NASA; 11M downloads by 2015
  (en.wikipedia.org/wiki/GNS3).
- **EVE-NG** — no Wikipedia article exists (fetched, missing page — a signal
  about documentation culture in that segment).

## Why the winners win

1. **Free + offline + drag-drop** (Packet Tracer): zero friction beats realism
   for learners; certification alignment drives volume.
2. **Real images / real configs** (GNS3, containerlab, CML): authenticity is
   the killer feature for professionals — but brings licensing/resource pain.
3. **Declarative, text-first labs** (netlab, containerlab): reproducible,
   git-shareable, CI-able — the "share one file" pattern.
4. **Config validation without running** (Batfish): catch errors before deploy;
   enterprise safety value.
5. **Active maintenance**: every winner above pushed commits this month.

## Why products fail or die

1. **Abandonment** — archived/stale repos (CounterFit 2023, SAP kit 2021, IBA
   2020): vendor priority shifts, niche scope, no community ownership.
2. **Weight & dependencies** — GNS3/EVE-NG-class setups demand VMs, images,
   RAM/CPU; the setup cost filters out casual users and classrooms.
3. **Licensing tax** — Cisco images/CML pricing and IOU/VEOS gray zones push
   users away or into EULA trouble.
4. **False realism** — tools that look authoritative but hide simplifications
   get burned in reviews and papers; trust, once lost, is gone.
5. **UI debt** — aging desktop GUIs; users migrate once a modern UX exists.
6. **Not shareable** — labs trapped in local DBs/VMs can't be handed to a
   colleague or graded; reproducibility fails.

## Most-requested features across this category (ranked, synthesis)

1. Save/share a whole lab as ONE portable file (or a git-friendly text file).
2. Extend with new devices/protocols without forking the tool.
3. Real syntax import/export (paste a real config, get a lab).
4. Runs anywhere: browser/offline, no account, no server, no admin rights.
5. Performance at scale + honest resource numbers.
6. Explainability: why was this packet dropped/allowed — rule, counters, trace.
7. Automation: scripted scenarios, seed/version stamps, reproducible exports.
8. Teaching mode: guided scenarios, expected-vs-actual, grading hooks.
9. Clean, modern UI that never obstructs the topology.
10. Truthful limitations ("not enforceable", "estimate") instead of fake data.

## Applied to Warden32 (already in the spec)

| # | Decision |
|---|---|
| 1 | §2 single-file `.warden32` projects (open/save/import/export/recovery) |
| 2 | §2/§6 extension registry + `docs/EXTENDING.md` |
| 3 | §8 dialect selector with validation (real grammars, no invented syntax) |
| 4 | §5 offline browser app — no backend, no account |
| 5 | §14 resource model + Web Worker move planned; bounded event logs |
| 6 | §9 packet pipeline explainability (rule, NAT, counters, provenance) |
| 7 | §16 experiments: seed + versions + CSV/JSON exports |
| 8 | §15 Attack Lab with multi-select scenarios + expected-vs-actual |
| 9 | §15.1 final design: topology owns the center, panes collapse |
| 10 | §3 provenance tags + honesty laws + `not enforceable` labels |
