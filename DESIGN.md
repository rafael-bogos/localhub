---
name: localhub
description: A desk instrument for local-dev housekeeping, not a dashboard — ports as physical keys on a gunmetal panel.
colors:
  chassis-bg: "#14161a"
  chassis-panel: "#1a1d22"
  key-surface: "#d9d2c3"
  key-surface-hover: "#e1dbcd"
  bezel: "#1c1f24"
  orange: "#ff5a2e"
  orange-strong: "#ff7648"
  orange-pressed: "#d6431c"
  amber: "#ffb238"
  ink-primary: "#e9e6df"
  ink-secondary: "#92948f"
  ink-tertiary: "#86887f"
  key-ink: "#2a2822"
  key-ink-muted: "#554f44"
typography:
  body:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.62rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.1em"
  wordmark:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "0.92rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.08em"
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"
    fontSize: "0.88rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  data-emphasis:
    fontFamily: "IBM Plex Mono, ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"
    fontSize: "1.05rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "normal"
rounded:
  key: "8px"
  chip: "5px"
  pill: "999px"
spacing:
  row-gap: "8px"
  panel-padding: "14px 16px 16px"
  cell-padding: "11px 14px"
components:
  kill-key:
    backgroundColor: "{colors.orange}"
    textColor: "#fff3ee"
    rounded: "{rounded.chip}"
    padding: "7px 13px"
  kill-key-disabled:
    backgroundColor: "{colors.bezel}"
    textColor: "{colors.ink-tertiary}"
    rounded: "{rounded.chip}"
    padding: "7px 13px"
  status-chip:
    backgroundColor: "{colors.bezel}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  status-chip-listen:
    backgroundColor: "{colors.bezel}"
    textColor: "{colors.amber}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  port-row:
    backgroundColor: "{colors.key-surface}"
    textColor: "{colors.key-ink}"
    rounded: "{rounded.key}"
    padding: "11px 14px"
  refresh-btn:
    backgroundColor: "{colors.bezel}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.pill}"
    size: "32px"
---

# Design System: localhub

## Overview

**Creative North Star: "The Creator's Bench"**

localhub is an instrument built by someone who makes their own tools, not a SaaS admin panel. It renders every open port as a physical key on a dark, machined instrument case: a gunmetal chassis holds a grid of raised bone-colored keycaps, an amber glass-tube counter reads the live port count, and one loud safety-orange key is the sole way to end a process. The voice is precise, technical, tactile, and has zero ceremony — nothing slow, decorated, or gamified, and nothing borrowed from the generic soft-shadow/gradient-blue SaaS-admin-dashboard default. This is also not a warm/bookish/cream world: the case reads cool and machined; the only warmth in the system is the keycap material itself and the orange/amber accents.

This is a code-led build (no comp/image round; the direction contract's assigned oscilloscope/lab-panel form lost a direction-roll fusion to the "creator hardware bench" challenger, which is what shipped). Three raises are load-bearing, not decoration: the Nixie Laboratory Counter glow-and-mesh treatment on the port count, the Exposure Record hatch texture marking protected rows (never color alone), and the Mesophotic cool-down fade (`COOL_DOWN_MS = 340`) that lets a killed row dim out instead of vanishing abruptly.

**Key Characteristics:**
- Dark gunmetal chassis holding light, physically raised keycap rows — layered and lifted, never flat.
- One safety-orange kill/danger role, spent only on the kill key and the error alert.
- One instrument-amber live-status role, spent only on the port counter and the LISTEN chip.
- IBM Plex Mono for every data value (port, protocol, PID, status); IBM Plex Sans for all chrome and copy, set in Brazilian Portuguese.
- Whole-row grid reflow on narrow viewports — never a fractional or broken table.

## Colors

A three-role palette on a cool dark ground: one neutral chassis system, one danger accent, one live-status accent. No blues, no gradients beyond the two accent buttons' own vertical shade.

### Primary
- **Safety Orange** (`--orange` #ff5a2e / `--orange-strong` #ff7648 / `--orange-pressed` #d6431c): the single kill/danger role. Used only on the kill key (gradient fill, pressed-edge shadow) and the error alert banner's text/icon. Two surfaces, one role — this is a deliberate "kill/danger" merge, not scope creep.

### Secondary
- **Instrument Amber** (`--amber` #ffb238): the single live-status/count role. Used for the port counter's glowing digit readout (with rib-mesh texture, glass-reflection highlight, and a `counter-tick` pulse on change) and the `status-chip--listen` variant. Never used for anything else.

### Neutral
- **Gunmetal Case** (`--chassis-bg` #14161a, `--chassis-panel` #1a1d22): the dark instrument body — page background, fascia, and instrument-panel surfaces, textured with a faint diagonal brushed-metal repeating gradient and inset top highlight.
- **Bone Keycap** (`--key-surface` #d9d2c3, hover `--key-surface-hover` #e1dbcd): the raised light material every port row is built from.
- **Bezel** (`--bezel` #1c1f24): the recessed dark inset-window color, reused identically for the counter's glass tube, the status chip background, and the disabled/protected kill-key background — one token, three "small display window" contexts.
- **Ink on chassis**: `--ink-primary` #e9e6df (primary legends), `--ink-secondary` #92948f (secondary/refresh-icon), `--ink-tertiary` #86887f (column headers, counter caption, empty-state text — raised from a ~2.5:1 contrast failure to ~4.7:1 during the ship round; this value is now the floor, not a placeholder).
- **Ink on keycap**: `--key-ink` #2a2822 (primary row text), `--key-ink-muted` #554f44 (protocol/PID secondary values).

### Named Rules
**The One Loud Key Rule.** Safety Orange appears in exactly two places system-wide (kill key, error alert) and nowhere else. Its rarity is what makes it read as consequential.
**The Bezel-Is-a-Window Rule.** Any small recessed/inset display — a counter, a status readout, a disabled control — draws from the same `--bezel` token. Don't invent a second dark inset shade.

## Typography

**Body/Chrome Font:** IBM Plex Sans (self-hosted, weights 400/500/600/700)
**Data Font:** IBM Plex Mono (self-hosted, weights 400/500/600)

**Character:** A workhorse technical pairing — Plex Sans carries chrome, labels, and Portuguese copy; Plex Mono is reserved for every value that comes off the machine (port, protocol, PID, process, status), so the eye can tell "label" from "reading" without color.

### Hierarchy
- **Data-emphasis** (600, 1.05rem, tabular-nums): the port counter's digit readout only — the one number the instrument makes loud.
- **Wordmark** (600, 0.92rem, 0.08em tracking, uppercase): the "localhub" brand mark in the fascia.
- **Data** (400, 0.88rem): port/protocol/PID/process/status values inside each keycap row, always mono.
- **Body** (400, 0.85rem): alert and empty-state copy, in Plex Sans.
- **Label** (600, 0.6–0.72rem, 0.1em tracking, uppercase): column headers, counter caption, kill-key legend, status chip text.

### Named Rules
**The Mono-Is-Data Rule.** IBM Plex Mono marks a live value read off the system; IBM Plex Sans marks everything the interface itself is saying. Never swap the two.

## Layout

Single-window instrument fascia over one scrolling instrument panel: `app-shell` is a full-height flex column (16px padding, 14px gap) holding a fixed-height `fascia` header strip and a flex-1 `instrument-panel` body. The port grid itself is a table with `border-spacing: 0 8px` so each row reads as a discrete keycap with an 8px gap to the next, not a bordered grid. Below 720px, each row switches from a five-column table row to a named CSS grid (`grid-template-areas`) that reflows whole fields onto two lines — port/protocol/action on one line, process/pid/status on the next — never a fractional or broken column squeeze.

## Elevation & Depth

Hybrid: the chassis conveys depth through machined-panel treatment (brushed-texture repeating gradient, inset top highlight, ambient outer drop-shadow, small corner rivet dots via `::before`/`::after` on `.fascia` and `.instrument-panel`), while each port row is a physically raised object lifted off that case (paired inset top-highlight/bottom-shadow on the cell plus a row-level `filter: drop-shadow(0 2px 3px rgba(0,0,0,0.3))`). Depth is structural, not ambient decoration — it's how the "key resting in a case" reading is achieved.

### Shadow Vocabulary
- **Panel ambient** (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.035), 0 2px 6px rgba(0,0,0,0.25)`): fascia and instrument-panel resting depth.
- **Key lift** (`box-shadow: inset 0 1px 0 var(--key-highlight), inset 0 -1px 0 var(--key-shadow)` + `filter: drop-shadow(0 2px 3px rgba(0,0,0,0.3))`): every port row at rest.
- **Bezel recess** (`box-shadow: inset 0 1px 3px rgba(0,0,0,0.5)`): the counter tube and other inset-window surfaces.
- **Kill-key press** (`box-shadow: 0 2px 0 var(--orange-pressed), 0 3px 5px rgba(0,0,0,0.35)`, collapsing to `0 0 0 var(--orange-pressed)` + `translateY(2px)` on `:active`): the button's skeuomorphic travel.

### Named Rules
**The Raised-Key Rule.** A port row is never flat-filled; it always carries the highlight/shadow pairing plus the row-level drop-shadow. A flat table row is a regression to the pre-ship "plain HTML table" the direction contract explicitly refused.

## Shapes

Two radii cover the system: `--radius-key` (8px) for rows, the fascia, and the instrument panel — the "keycap" unit; `--radius-chip` (5px) for smaller controls — buttons, status chips' base shape before the pill override, and the alert banner. Fully round (`999px`) is reserved for circular/pill forms: the refresh knob and the status-chip pill shape. No sharp corners anywhere in the system; no borders beyond hairline chassis seams (`--chassis-seam`, 1px, 5% white) separating structural panels.

## Components

### Buttons
- **Kill-key** (radius 5px / `--radius-chip`): the system's one committed action. Orange gradient fill (`--orange-strong` → `--orange`), white-warm text (`--orange-ink` #fff3ee), bottom-edge pressed-color shadow simulating physical thickness. On `:active`, the key travels down 2px and its shadow collapses — a genuine press, not a color-only hover swap. Disabled state (invalid PID) drops to the `--bezel` background with `--ink-tertiary` text — visually demoted to "can't be pressed," matching the protected-row hatch signal.
- **Refresh knob** (fully round, 32px): a knurled-look control (`repeating-conic-gradient` teeth + inset bezel face) rather than a flat icon button; spins its icon while loading.

### Chips
- **Status chip** (`--radius-pill`, background `--bezel`, text `--ink-secondary`): the default state-readout chip.
- **LISTEN variant**: text switches to `--amber` with an inset amber-dim ring — the only chip variant that borrows the live-status color.

### Cards / Containers
- **Corner Style:** 8px (`--radius-key`) for the fascia and instrument-panel; port rows share the same radius per-cell on their outer edges only.
- **Background:** `--chassis-panel` for structural containers; `--key-surface` for rows.
- **Shadow Strategy:** see Elevation & Depth — machined-panel ambient shadow for containers, raised-key shadow for rows.
- **Border:** 1px `--chassis-seam` hairlines only; no borders on keycap rows.
- **Internal Padding:** panel `14px 16px 16px`; row cell `11px 14px`.

### Signature Component: The Port Row
One `<tr>` per open port is the system's defining unit: a bone keycap bar with mono data on the left/center, a pill status chip, and an orange kill-key at the far right. Two state overlays are load-bearing and must never be replaced by color alone: `.port-row--protected` adds a diagonal hatch texture (`--bezel-hatch`, 135deg repeating stripe) to the first cell when the kill action is disabled (PID ≤ 0); `.port-row--cooling` triggers a 320ms fade-to-grayscale-and-shrink transition after a successful kill, coordinated with `COOL_DOWN_MS = 340` in `App.tsx`, before the row is removed from the list.

## Do's and Don'ts

### Do:
- **Do** keep Safety Orange to exactly the kill key and the error alert — one "kill/danger" role, not a general accent.
- **Do** mark protected/disabled rows with the diagonal hatch texture, never with color alone.
- **Do** use IBM Plex Mono for every value read off the live system (port, protocol, PID, process, status) and IBM Plex Sans for everything the interface says.
- **Do** give every pressable control (kill-key, refresh knob) real travel — a shadow collapse and/or `translateY` on `:active`, not a flat color-only hover.
- **Do** reflow narrow layouts by whole field groups via named CSS grid areas, never by letting columns shrink into a broken fractional table.

### Don't:
- **Don't** introduce a second accent color outside the orange (kill/danger) and amber (live-status) roles.
- **Don't** flatten a port row to a single background fill — it must carry the highlight/shadow key-lift pairing plus the row-level drop-shadow.
- **Don't** revert to a plain HTML table look or a generic soft-shadow/gradient-blue admin-dashboard treatment; both are explicitly refused by the direction contract this system was built against.
- **Don't** translate interface copy out of Brazilian Portuguese; it is the product's permanent voice, not a placeholder.
