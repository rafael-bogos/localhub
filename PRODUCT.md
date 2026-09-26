# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Wails v2 (Go backend) + React + TypeScript + Vite frontend, packaged as a native desktop app via a webview. This scaffold predates this record; not a fresh decision.

## Users

The author, as a solo developer, using localhub on their own machine during local development.

## Product Purpose

localhub is becoming a local developer-tools hub: a single desktop app for the small, repetitive housekeeping tasks of a local dev environment. Ports are the first feature — it shows every local TCP/UDP port currently bound and which process holds it, and lets the user kill that process directly from the list, replacing the terminal ritual of `lsof -i` / `netstat` plus `kill -9 <pid>` with a single glance-and-click. Docker container and image management (start/stop/remove containers, list/prune images) is planned as the next feature area. Success is: faster than the terminal, every time, for whichever local-dev chore the hub covers.

## Positioning

The value is removing friction from local-dev housekeeping: one click instead of remembering flags and copying IDs between terminal commands. Unlike the earlier read, this now has a committed roadmap beyond ports (Docker container/image management is next), so the product surface is expected to grow multi-section (ports today, containers/images later) rather than stay a single-purpose port killer. Still not competing on breadth with Activity Monitor/Task Manager or Docker Desktop's full feature set — competing on speed for the specific chores a solo dev repeats daily.

## Operating Context

Used ad hoc during local development, most often right after a "port already in use" / "address already in use" error from a dev server, or when cleaning up stray background processes. Single-window desktop utility, no accounts, no persistence beyond the live process list.

## Capabilities and Constraints

- Lists listening TCP sockets and bound UDP sockets with port, protocol, PID, process name, and status (`internal/ports/ports.go`).
- Kills a process by PID with a native confirm dialog before acting; PID `<= 0` is treated as invalid and the kill button is disabled for it.
- No filtering, sorting (beyond ascending port), search, or history yet — undecided whether these get added.
- Docker container and image management is planned as the next feature area (not yet built): exact scope (start/stop/remove containers, image listing/pruning, logs?) is undecided.
- Runs cross-platform wherever `gopsutil` and Wails do (contingent on `syscall.SOCK_STREAM`/`SOCK_DGRAM` support).

## Brand Commitments

- Product name: **localhub**.
- Interface language is Brazilian Portuguese by deliberate choice ("Atualizar", "Matar", "Nenhuma porta encontrada"), not a placeholder to translate.
- Existing logo asset at `frontend/src/assets/images/logo-universal.png` (Wails template default; not confirmed as final brand mark).

## Evidence on Hand

None. No testimonials, case studies, or usage data exist or should be fabricated; this is a personal tool with a single user.

## Product Principles

1. Optimize each chore's one loop that matters — see it, act on it — over adding breadth within a section.
2. Never make killing a process silently easy: the confirm step is load-bearing, not friction to remove.
3. Portuguese is the product's real voice, not a stand-in for English.
4. Stay a fast, always-current live view; no state to manage beyond what's true right now on the machine.
