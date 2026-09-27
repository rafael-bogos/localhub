# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Wails v2 (Go backend) + React + TypeScript + Vite frontend, packaged as a native desktop app via a webview. This scaffold predates this record; not a fresh decision.

## Users

The author, as a solo developer, using localhub on their own machine during local development.

## Product Purpose

localhub is a local developer-tools hub: a single desktop app for the small, repetitive housekeeping tasks of a local dev environment, organized as tabs in one instrument fascia. Ports was the first feature — shows every local TCP/UDP port currently bound and which process holds it, and lets the user kill that process directly from the list, replacing the terminal ritual of `lsof -i` / `netstat` plus `kill -9 <pid>` with a single glance-and-click. Containers and Imagens (Docker) shipped next — list/start/stop/restart/remove containers and list/remove/prune Docker images, replacing `docker ps` / `docker stop` / `docker rm` / `docker images` / `docker rmi` / `docker image prune`. Success is: faster than the terminal, every time, for whichever local-dev chore the hub covers.

## Positioning

The value is removing friction from local-dev housekeeping: one click instead of remembering flags and copying IDs between terminal commands. The product surface is multi-section by design (Portas / Containers / Imagens today, more later), not a single-purpose port killer. Still not competing on breadth with Activity Monitor/Task Manager or Docker Desktop's full feature set — competing on speed for the specific chores a solo dev repeats daily.

## Operating Context

Used ad hoc during local development, most often right after a "port already in use" / "address already in use" error from a dev server, or when cleaning up stray background processes. Single-window desktop utility, no accounts, no persistence beyond the live process list.

## Capabilities and Constraints

- Lists listening TCP sockets and bound UDP sockets with port, protocol, PID, process name, and status (`internal/ports/ports.go`).
- Kills a process by PID with a native confirm dialog before acting; PID `<= 0` is treated as invalid and the kill button is disabled for it.
- No filtering, sorting (beyond ascending port), search, or history yet — undecided whether these get added.
- Lists Docker containers (running + stopped, running first) and lets the user start/stop/restart/remove them (`internal/docker/containers.go`); removing a running container is blocked until it is stopped first, never forced.
- Lists local Docker images (repository:tag, size, created date) and lets the user remove one, or prune all dangling (`<none>:<none>`) images at once (`internal/docker/images.go`).
- Talks to the Docker Engine API directly via the official SDK (`github.com/moby/moby/client`), not by shelling out to the `docker` CLI; shows a clear Portuguese error (not a raw SDK message) when the daemon isn't reachable.
- No container logs, `exec`, image `pull`/`build`/`run`, volumes, networks, or remote Docker hosts — out of scope for now.
- Runs cross-platform wherever `gopsutil`, Wails, and a local Docker daemon do (contingent on `syscall.SOCK_STREAM`/`SOCK_DGRAM` support for ports, and a reachable Docker socket for containers/images).

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
