---
version: 1
slug: "app"
primary_target: "app"
related_targets: ["frontend/src/App.tsx"]
---

## Direction contract

THESIS: localhub is a desk instrument, not a dashboard. Every port is a physical key in a tactile grid; killing a process is pressing the one bold orange key that means business. Refuses both the plain-HTML-table look currently shipped and the generic SaaS-admin-dashboard default (soft-shadow cards, gradient blues) the brief explicitly ruled out.

OWN-WORLD: Dark gunmetal/graphite chassis ground; bone/putty keycap-gray rows; charcoal ink for labels. ONE safety-orange, reserved only for the kill action. An amber/phosphor glow readout (nixie-counter raise) for the live count of open ports. Dye-sublimated mono legends (IBM Plex Mono) for port/PID/status values; a matching workhorse sans (IBM Plex Sans) for chrome and copy, set in Portuguese. Grid reflows by whole keycap units, never fractional.

STORY: A solo dev opens localhub right after a port conflict, scans the instrument panel, spots the offending port/PID in seconds, presses its orange kill key. The native confirm gate stays mandatory (restyled, never removed). On confirm, the key visibly commits (travel + click) and the row cools out via a short dim/fade transition rather than vanishing abruptly; the amber counter ticks down.

FIRST VIEWPORT: One instrument fascia. Top strip: "localhub" wordmark left, amber-glass counter tube showing total open ports right, knurled-icon refresh control beside it. Below: the keycap grid, one row per port/process — port + protocol left, process name center, PID + status in small caps, kill key in orange far right — on the gunmetal chassis with hairline seams between rows. Rows for protected/system processes carry a hatch pattern (exposure-record raise), never color alone, so the signal survives without color.

FORM: Assigned direction was oscilloscope/lab-instrument-panel (own grounded candidate #3). Challenger `design-canon-creator-hardware-bench` won on both audience-identification and product-clarity and becomes the build. Seed key: 36e8e9b9. Raises: Nixie Laboratory Counter (glowing digit-tube header counter) · Exposure Record Zone Sheets (hatch pattern marks protected rows, never color alone) · Mesophotic Deep Dive (coordinated cool-down fade on kill instead of abrupt removal). Color strategy: Full palette, 3 named roles (chassis neutral, orange = kill/danger, amber = live status/count). Dark ground, matching the current app and the late-night dev-desk scene this tool lives in. Code-led build: no image generation available this session, no comp round.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
