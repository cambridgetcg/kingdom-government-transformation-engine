# AGENTS.md

## Scope

This repository produces one static, read-only United Kingdom Government Transformation Orientation Engine Phase-0 snapshot. It contains three visibly synthetic, non-personal dossiers. It does not adopt a proposal, decide, approve, authorise, rank, score, implement, evaluate, operate, deploy, file, pay, procure, spend, transact, select a remedy, calculate a deadline, determine eligibility or liability, access an account or identity, collect credentials or personal data, call an API, use an LLM, expose MCP, accept submissions, or create an external effect.

## Required commands

Run all of these before changing a frozen receipt or handing off an artifact:

```sh
npm test
npm run validate
npm run build
npm run build:check
npm run check
```

`build` may write only `public/transformations.json`. Validation, build and check must remain zero-dependency and offline. The canonical build must not depend on wall-clock time.

## Contract rules

- Keep exactly one Draft 2020-12 schema at `schemas/v0.1/public-snapshot.schema.json`; every object is closed and every property required.
- Keep strict JSON IO: fatal UTF-8, duplicate-key rejection, safe integers, bounded bytes/depth/nodes/collections/strings, no symlink inputs and inert prototype-shaped member names.
- Keep the exact vendored base at `vendor/government-engine/government-2026-08-21.json`: 196005 bytes, byte SHA-256 `1751b2ac331d6a1283cbf57b5b6961d9071f528298f97589fcbd7cf36407e139`, canonical SHA-256 `cc2c22e356cef0160ed5da1e2fd756bad5801f574c4cb064dec157b9207b9739`.
- Do not replace the base with a mutable URL or runtime fetch. Evidence atoms may pin exact base IDs only.
- Official-source handling is link-only and exact text is not human-reviewed. A generic official hostname is never evidence.
- TaxSorted may appear only through exact admitted Government Engine bridge/record IDs, with `supportsClaimIds: []` and `external-context-only` taint. Do not copy TaxSorted graphs or record text.
- Each dossier has exactly six plane assessments. Allowed statuses are only `not-assessed`, `insufficient-evidence`, `contested`, `specialist-review-required`, and `orientation-supported`. Never publish pass/approved/lawful/authorised/funded/eligible/ready or a scalar score.
- `orientation-supported` is invalid while a relevant human gate is incomplete, an unresolved question exists, specialist review is required, or evidence is non-supporting.
- Dependency direction is `fromId` prerequisite to `toId`; no edge implies automatic progression. Causal edges are hypotheses, never causal truth.
- Keep one BAU and at least two alternatives per dossier, with distinct outputs and no selected or preferred option.
- Keep every human gate required and incomplete; adoption and all decision authority remain outside the system. All five action arrays remain empty.
- Trial Chamber compatibility remains unavailable, with no result and no authority use.
- After `2026-09-21`, immutable bytes remain reproducible as historical orientation only. A separate site release gate must replace or atomically retire the mutable five-route family.

## Repository operations

Do not commit, tag, push or publish without a separate explicit maintainer instruction. Do not edit KINGDOM-OS, the Government Engine producer or TaxSorted from this repository task.
