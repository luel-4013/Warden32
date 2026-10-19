# Warden32 style guide

Scope: design tokens, shell layout, component vocabulary, tone and provenance
semantics, typography, and the procedure for validating the kept design kit
(`ui-demo.html`) against the shipped stylesheet (`src/styles.css`). Everything
below states what exists in this build; nothing is aspirational.

Sources of truth:

- `ui-demo.html` — kept design kit. It contains 19 theme candidates; candidate
  **#19** is the chosen look. The kit stays in the repository so palettes and
  layouts for future work are preserved (no build step, no dependencies).
- `src/styles.css` — the implementation. It is plain CSS (no Tailwind, no CSS
  framework), imported once from `src/main.tsx` (`import "./styles.css"`).
  Token values are copied verbatim from kit #19 (DECISIONS.md, 2026-10-18 M1).

## 1. Design tokens

Defined in `src/styles.css` under `:root` (lines 1–15).

| Token | Value |
| --- | --- |
| `--bg` | `#0c1116` |
| `--panel` | `#111820` |
| `--side` | `#0e151c` |
| `--border` | `#22303c` |
| `--text` | `#d9e4ec` |
| `--muted` | `#7f95a6` |
| `--accent` | `#2fd6a8` |
| `--ok` | `#37d99b` |
| `--drop` | `#ff6f6f` |
| `--warn` | `#ffc46b` |
| `--radius` | `6px` |
| `--radius-sm` | `4px` |
| `--mono` | `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

Facts worth knowing when editing:

- The app inlines several alpha shades instead of defining tokens for them:
  `rgba(47, 214, 168, 0.08)` for selection/notice backgrounds,
  `rgba(47, 214, 168, 0.05)` for tree hover, `rgba(47, 214, 168, 0.03)` for
  table-row hover, `rgba(34, 48, 60, 0.5)` for table cell borders,
  `rgba(233, 238, 246, 0.6)` for scrollbar thumbs, and
  `rgba(6, 12, 16, 0.72)` for the drag-and-drop overlay.
- Kit #19 defines four tokens the app does not carry over: `--node: #0f1720`,
  `--rowline: #18232e`, `--sideon: rgba(47,214,168,.08)`,
  `--font-ui: var(--mono)`. Their values are either unused by the current shell
  or inlined (see above). The app adds `--mono`; the kit has the equivalent
  under a different name.
- Status-bar text on the accent background is `#06231a` in the app
  (`.statusbar.accent`); kit #19 used `#06140f`. This is an existing, minor
  deviation; change both files together if touched.

Measured WCAG contrast ratios of the shipped pairs (relative luminance,
`sRGB`; informational):

| Pair | Ratio |
| --- | --- |
| `--text` on `--bg` | 14.68:1 |
| `--text` on `--panel` | 13.83:1 |
| `--muted` on `--bg` | 6.10:1 |
| `--muted` on `--panel` | 5.74:1 |
| `--accent` on `--bg` | 10.21:1 |
| `--accent` on `--side` | 9.89:1 |
| `--ok` on `--bg` | 10.44:1 |
| `--drop` on `--bg` | 7.00:1 |
| `--warn` on `--bg` | 12.06:1 |
| `#06231a` on `--accent` | 8.95:1 |
| `--border` on `--bg` (non-text divider) | 1.41:1 |

## 2. Shell layout

The shipped shell is a single full-height column (`.app`) composed of:

1. `.top` — header bar: brand (`WARDEN32`), project name, `new` / `open` /
   `save` buttons, the firmware `<select>`, and the primary `run battery`
   button.
2. `.notice` — dismissible one-line status message (`.notice-close`), shown
   only while a notice is set.
3. `.ide-body` — the IDE grid:
   `grid-template-columns: 42px 156px minmax(0, 1fr) 320px`
   (activity rail, explorer, center, right pane).
4. `.statusbar.accent` — footer.

Grid regions:

| Region | Element | Contents |
| --- | --- | --- |
| Activity rail | `.activity` | 12 glyph buttons (`OV TP TR FW AT IN RS EX CP HW RG DC`), one per page; active button `.on`. |
| Explorer | `.explorer` > `.wtitle` + `.tree.scroll` | Zone headers (`.tree-h`) and device rows (`.tree-i`, `.tree-i.on`). Device rows append glyph suffixes for router (`⌂`), compromised (`⚠`), quarantined (`⛔`). |
| Center | `.center` > `.tabs` + `.center-body.scroll` | Page tabs (`.tab`, active `.tab.on` with an inset accent underline) and the current page component. |
| Right pane | `.right` > `.tabs` + `.pane.grow` | Five tabs: `[1] inspect`, `[2] rules.fw (n)`, `[3] packets.log`, `[4] console`, `[5] attacks`. |

The footer `.statusbar.accent` always shows, in order: firmware name, policy
baseline, ACL dialect, seed, node count, link (adapter name), and
`engine <version> · deterministic`. Screenshot reproducibility depends on this
bar; keep its fields stable.

Known layout deviation from the kit: kit #19 uses
`grid-template-columns: 42px 156px 1fr 248px` for `.t19 .ide-body`, while the
app uses `minmax(0, 1fr)` for the center column and `320px` for the right pane.
The app value is the intended shipped layout; treat kit drift as a candidate
for a kit update, not an app bug.

Stylesheet selectors `.work`, `.canvas-pane`, `.topology`, and `.side` are
retained from the earlier two-column milestone and are not referenced by the
current shell components. `.statusbar.hint` is defined but unused. They may be
removed only after a repository-wide search confirms no runtime users.

## 3. Component vocabulary

Reusable primitives live in `src/app/ui.tsx`; pages compose them.

| Component | Renders | Notes |
| --- | --- | --- |
| `Pane` | `section.pane > .pane-title + .pane-scroll.scroll` | `title` on the left, optional `right` node in `.pane-actions`. |
| `Chip` | `span.chip <tone>` | Small pill for tags, verdicts, provenance. |
| `KV` | `dl.kv > dt + dd` | Key/value row; optional `tone` class on the `dd`. |
| `KVGroup` | `div.kv-group` | Structural grouping wrapper; `.kv-group` has no CSS rule of its own. |
| `Empty` | `p.meta` | Plain muted placeholder text. |

`Tone` is a string union: `"ok" | "warn" | "danger" | "accent" | "muted" | ""`.
The stylesheet styles `.chip.ok`, `.chip.danger`, and `.chip.warn`; there are
no `.chip.accent` or `.chip.muted` rules, so those chips render with the base
chip look (border + muted text). Tones on `KV` values and standalone spans use
`.tone-ok`, `.tone-warn`, `.tone-danger`, `.tone-accent`, `.tone-muted`.

Additional class vocabulary used by pages:

| Class | Purpose |
| --- | --- |
| `.page` | Page container: 12/14 px padding, 10 px vertical gap, column flex. |
| `.grid2`, `.grid3` | Equal-width two/three column grids. |
| `.row` | Wrapping flex row for buttons and inline metadata. |
| `.card` | Panel with border and radius (attack cards, incident cards, injectors). |
| `.table` | Dense data table: 11 px, muted uppercase-ish headers, hover tint. |
| `.gauge` + `.gauge-fill` | Thin progress bar; modifiers `.warn` (≥ 60–70 %) and `.danger` (≥ 85–90 %) are chosen per page. |
| `.input` | Text/number inputs; focuses to an accent border. |
| `.labels` | Chip wrap container. |
| `.natchain` | Accent monospace NAT-chain line in packets.log. |
| `.vendors h5` | Small section heading used inside incident evidence/action lists and inspector blocks. |
| `.dropzone` | Fixed full-screen overlay shown while a project file is dragged over the window. |

## 4. Tone and provenance semantics

Engine verdicts map to tones through `VERDICT_TONE` (`src/app/ui.tsx`):

| Verdict | Tone | Meaning |
| --- | --- | --- |
| `allowed` | `ok` | The pipeline permitted the flow. |
| `denied` | `danger` | Policy explicitly blocked the flow. |
| `dropped` | `danger` | Failure or boundary condition prevented delivery. |
| `not-enforceable` | `warn` | The enforcement point never saw the frame; never shown as "blocked". |

Event categories map through `CATEGORY_TONE`: `attack` and `incident` are
`danger`; `firewall`, `resource`, and `wifi` are `warn`; `system` and
`conntrack` are `muted`; `metrics` is `accent`; `pipeline`, `nat`, `routing`,
and `traffic` use the base chip look.

Flow labels rendered as chips are toned by `toneForLabel` (substring rules,
grouped here for readability; the substrings do not overlap, so source order
does not change outcomes):

| Label contains | Tone |
| --- | --- |
| `not implemented on hardware`, `isolation`, `no egress filtering`, `no route`, `non-IPv4`, `port-forward` | `warn` |
| `management surface reachable`, `quarantine`, `RAM`, `NAPT`, `tx queue`, `spoofed` | `danger` |
| `double NAT` | `muted` |
| anything else | base chip |

Provenance tags have five values (`measured`, `datasheet`, `paper`,
`estimate`, `assumption`). Two tone mappings exist and differ deliberately:

- `DocsPage` legend: `measured` → `ok`, `datasheet` → `accent`, `paper` →
  `muted`, `estimate` → `warn`, `assumption` → `warn`.
- `provenanceTone` helper (HardwarePage, RegistryPage): `measured` → `ok`,
  `datasheet` → `accent`, `assumption` → `warn`, everything else (`paper`,
  `estimate`) → `muted`.

The legend states the meaning; the helper marks only actionable provenance.
When adding a new provenance chip, prefer `provenanceTone` for tables and the
legend mapping for documentation contexts, and keep both lists consistent if
the tag set changes.

Calculator conventions: the `metricRows` table prints every provenance chip as
`muted` with the provenance string inside; the compare table does the same.
Do not color estimate values as data.

## 5. Typography

The whole UI is monospace (`font-family: var(--mono)`), 13 px base.

| Element | Size / treatment |
| --- | --- |
| `.brand` | Accent, weight 700, letter-spacing 2 px. |
| `.brand-sub` | 11 px, muted. |
| `.pane-title` | 11 px, muted, letter-spacing 1 px, panel background. |
| `.tab` | 11 px, muted; active gets `--text` plus inset 2 px accent underline. |
| `.tree-i` | 11.5 px, text; active accent on an 8 % accent background. |
| `.tree-h` | 10 px, uppercase, letter-spacing 1.2 px, muted. |
| `.card h4` | 12 px, letter-spacing 0.5 px. |
| `.meta` | 11 px, muted. |
| `.reason` | 11.5 px, regular text color. |
| `.kv` | 11.5 px grid, `84px minmax(0, 1fr)`. |
| `.table` | 11 px; `th` muted, letter-spacing 0.8 px. |
| `.page h2` | 13 px, accent, letter-spacing 1.5 px. |
| `.page h3` | 11.5 px, muted, letter-spacing 1 px. |
| `.natchain` | 11 px, accent. |
| `.statusbar` | 11 px, muted; `.statusbar.accent` overrides to accent background and dark text (spans weight 600). |

## 6. Rules for new UI

1. Use tokens only; do not introduce new hex colors without adding them to
   `:root`, the kit, and this document.
2. Selectable/interactive state uses `--accent`. Verdict color is fixed:
   allowed → `ok`, denied/dropped → `drop`, not-enforceable → `warn`.
3. Never render "blocked" for anything the engine reports as
   `not-enforceable`.
4. Provenance must travel with every number: estimate and assumption values
   carry a chip; measured values never silently mix with model output.
5. Chips are labels; buttons are actions. Keep the distinction: chips never
   have click handlers, buttons never use chip classes.
6. New pages must be added to `PAGES` in `src/app/App.tsx` and to the smoke
   test page list (`src/app/app.smoke.test.tsx`).

## 7. Validating the design kit against the app

The kit is a static HTML file with exactly one inline `<script>` block and no
dependencies. Three checks keep it honest; all are offline.

### 7.1 Tag structure

```bash
python3 - <<'PY'
from html.parser import HTMLParser
VOID = {"area","base","br","col","embed","hr","img","input","link","meta","source","track","wbr"}
class Check(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack=[]; self.errors=[]
    def handle_starttag(self, tag, attrs):
        if tag not in VOID: self.stack.append((tag, self.getpos()))
    def handle_endtag(self, tag):
        if tag in VOID: return
        if not self.stack:
            self.errors.append(f"unexpected </{tag}> at {self.getpos()}"); return
        open_tag, pos = self.stack.pop()
        if open_tag != tag:
            self.errors.append(f"mismatch: <{open_tag}> at {pos} closed by </{tag}> at {self.getpos()}")
p=Check(); p.feed(open("ui-demo.html").read()); p.close()
print("ERRORS:", p.errors) if p.errors else print("UNCLOSED:", p.stack) if p.stack else print("ui-demo.html: tag structure OK")
PY
```

Expected output in this build: `ui-demo.html: tag structure OK`.

### 7.2 Inline script syntax

```bash
python3 -c "import re;s=open('ui-demo.html').read();m=re.findall(r'<script>(.*?)</script>',s,re.S);open('/tmp/ui-demo.js','w').write('\n;\n'.join(m));print(len(m),'script block(s)')" \
  && node --check /tmp/ui-demo.js && echo "inline JS syntax OK"
```

Expected: `1 script block(s)` followed by `inline JS syntax OK`.

### 7.3 Token drift

Compare the shared custom properties of `src/styles.css` `:root` and the
`.t19{...}` block of the kit:

```bash
python3 - <<'PY'
import re
css = open("src/styles.css").read()
kit = open("ui-demo.html").read()
root = dict(re.findall(r"(--[\w-]+):\s*([^;]+);", css.split(":root {",1)[1].split("}",1)[0]))
t19  = dict(re.findall(r"(--[\w-]+):\s*([^;]+);", kit.split(".t19{",1)[1].split("}",1)[0]))
drift = {k:(root[k],t19[k]) for k in root if k in t19 and root[k]!=t19[k]}
print("shared tokens:", len(set(root)&set(t19)), "| drift:", drift if drift else "none")
print("kit-only:", sorted(set(t19)-set(root)), "| app-only:", sorted(set(root)-set(t19)))
PY
```

Expected in this build: `shared tokens: 12 | drift: none`; kit-only
`['--font-ui', '--node', '--rowline', '--sideon']`; app-only `['--mono']`.
Any non-empty `drift` means the kit and the app have diverged; fix the kit (or
the app, deliberately) in the same change.

### 7.4 Manual checks

- Open the kit in a browser (no server required) and confirm theme #19 layout
  sections still render; the file is self-contained.
- Confirm the shell grid deviation (kit `248px` vs app `320px` right pane)
  before "fixing" it: the app value is authoritative.
- Contrast ratios in section 1 are computed for the shipped tokens; recompute
  them after any token change.
