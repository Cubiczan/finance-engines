# OpenSpec

This repo uses OpenSpec as the living documentation layer for behavior
changes. Do not generate specs for the whole existing codebase — create
specs as capabilities are touched.

## Layout

- `openspec/specs/` — current source of truth for specified capabilities
- `openspec/changes/<id>/` — in-flight change (proposal, design, tasks, deltas)

## Rules

- Engine core: zero network, deterministic, injectable clocks
- Do not change `LICENSE.md` or the UNLICENSED SPDX
- Match existing TypeScript / `node:test` style
- Existing MCP tools must keep working
