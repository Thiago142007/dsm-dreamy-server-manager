# DSM Windows Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-first "DSM - Dreamy Server Manager" MVP inspired by Blueprint features (extensions, filesystems, placeholders, flags, routes metadata) with dark-green/black UI.

**Architecture:** Use a zero-dependency Node.js backend (HTTP API + filesystem services) and a static frontend dashboard. Keep feature modules isolated (`storage`, `placeholders`, `flags`, `registry`) and validate behavior with Node's built-in test runner before implementation.

**Tech Stack:** Node.js 24, native `node:test`, HTML/CSS/vanilla JS

---

### Task 1: Project Scaffold + Tests Harness

**Files:**
- Create: `package.json`
- Create: `src/server.js`
- Create: `tests/smoke.test.js`

- [ ] Step 1: Write failing smoke test for health endpoint
- [ ] Step 2: Run `node --test` and verify RED
- [ ] Step 3: Implement minimal HTTP server + `/api/health`
- [ ] Step 4: Run `node --test` and verify GREEN

### Task 2: Storage Layer (public/private filesystems)

**Files:**
- Create: `src/lib/storage-manager.js`
- Create: `tests/storage-manager.test.js`

- [ ] Step 1: Write failing tests for put/get/exists/copy/move/list/delete
- [ ] Step 2: Verify failures on missing implementation
- [ ] Step 3: Implement secure path normalization + storage operations
- [ ] Step 4: Re-run targeted tests and verify pass

### Task 3: Flags + Placeholders

**Files:**
- Create: `src/lib/flags.js`
- Create: `src/lib/placeholders.js`
- Create: `tests/flags.test.js`
- Create: `tests/placeholders.test.js`

- [ ] Step 1: Write failing tests for comma flags and placeholder escaping
- [ ] Step 2: Implement parsers and rendering logic
- [ ] Step 3: Re-run tests to verify GREEN

### Task 4: Extension Registry + API

**Files:**
- Create: `src/lib/registry.js`
- Modify: `src/server.js`
- Create: `tests/registry.test.js`
- Create: `tests/api.test.js`

- [ ] Step 1: Write failing tests for extension registration and API JSON flows
- [ ] Step 2: Implement registry persistence + REST endpoints
- [ ] Step 3: Re-run full suite and verify all GREEN

### Task 5: Frontend Dashboard (Dark Green + Black)

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

- [ ] Step 1: Build dashboard shell and extension management UX
- [ ] Step 2: Add file explorer interactions with API
- [ ] Step 3: Apply visual direction (dark green/black, gradients, intentional typography, responsive layout)
- [ ] Step 4: Manual verification in browser

### Task 6: CLI Compatibility Surface (Windows)

**Files:**
- Create: `src/cli.js`
- Create: `dsm.cmd`
- Create: `tests/cli.test.js`

- [ ] Step 1: Write failing tests for basic commands (`-info`, `-version`, `-query`)
- [ ] Step 2: Implement command parser and outputs
- [ ] Step 3: Re-run tests and verify pass

### Task 7: Documentation and Runbook

**Files:**
- Create: `README.md`

- [ ] Step 1: Document architecture and feature mapping from Blueprint concepts
- [ ] Step 2: Document Windows run commands and storage layout
- [ ] Step 3: Add known limitations and next milestones