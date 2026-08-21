#!/usr/bin/env node

import { relative } from 'node:path'

import { ROOT, prettyCanonicalJson, sha256Json } from './io.mjs'
import {
  buildSnapshot,
  expectedReceipts,
  validateCheckedInSnapshot,
  writeSnapshot,
} from './transformation.mjs'

const HELP = `KINGDOM UK Government Transformation Orientation Engine v0.1 (offline, static, read-only)

Usage:
  kingdom-government-transformation validate   validate exact inputs, closed schema and semantic holds
  kingdom-government-transformation build      deterministically write only public/transformations.json
  kingdom-government-transformation check      prove the public artifact matches the deterministic build
  kingdom-government-transformation overview   print a bounded non-decision orientation summary
  kingdom-government-transformation help       print this help
`

function output(value) {
  process.stdout.write(prettyCanonicalJson(value))
}

function requireNoArguments(rest) {
  if (rest.length !== 0) throw new Error(`unexpected argument(s): ${rest.join(' ')}`)
}

function main() {
  const [command = 'help', ...rest] = process.argv.slice(2)
  if (command === 'help' || command === '--help' || command === '-h') {
    requireNoArguments(rest)
    process.stdout.write(HELP)
    return
  }
  requireNoArguments(rest)

  if (command === 'validate') {
    const snapshot = buildSnapshot()
    output({
      state: 'valid-static-read-only-transformation-orientation',
      asOf: snapshot.asOf,
      nextReviewDue: snapshot.freshness.nextReviewDue,
      counts: snapshot.counts,
      snapshotCanonicalReceipt: sha256Json(snapshot),
      baseSnapshotByteReceipt: expectedReceipts.baseByte,
      baseSnapshotCanonicalReceipt: expectedReceipts.baseCanonical,
      exactTextHumanReviewed: snapshot.authorship.exactTextHumanReviewed,
      humanReviewCompleted: snapshot.authorship.humanReviewCompleted,
      decisionAuthority: false,
      externalEffects: false,
      networkUsed: false,
    })
    return
  }

  if (command === 'build') {
    const built = writeSnapshot()
    output({
      state: 'built-deterministic-static-read-only-transformation-orientation',
      path: relative(ROOT, built.path),
      bytes: built.bytes,
      counts: built.snapshot.counts,
      snapshotByteReceipt: built.byteReceipt,
      snapshotCanonicalReceipt: built.canonicalReceipt,
      networkUsed: false,
    })
    return
  }

  if (command === 'check') {
    const checked = validateCheckedInSnapshot()
    if (!checked.current) throw new Error('public/transformations.json is absent or differs from the deterministic build')
    output({
      state: 'matches-deterministic-static-read-only-transformation-orientation',
      asOf: checked.snapshot.asOf,
      nextReviewDue: checked.snapshot.freshness.nextReviewDue,
      path: 'public/transformations.json',
      bytes: checked.bytes,
      counts: checked.snapshot.counts,
      snapshotByteReceipt: checked.byteReceipt,
      snapshotCanonicalReceipt: checked.canonicalReceipt,
      networkUsed: false,
    })
    return
  }

  if (command === 'overview') {
    const snapshot = buildSnapshot()
    output({
      phase: '0-static-read-only-transformation-orientation',
      asOf: snapshot.asOf,
      nextReviewDue: snapshot.freshness.nextReviewDue,
      immutableAfterDeadline: snapshot.freshness.immutableAfterDeadline,
      mutableAliasPolicy: snapshot.freshness.mutableAliasPolicy,
      dossiers: snapshot.dossiers.map((dossier) => ({
        id: dossier.id,
        title: dossier.title,
        hold: dossier.hold.state,
        options: dossier.options.length,
        planeAssessments: dossier.planeAssessments.length,
        humanReviewCompleted: dossier.humanGates.every((gate) => gate.completed),
      })),
      baseSnapshotCanonicalUrl: snapshot.baseSnapshot.canonicalUrl,
      baseSnapshotByteReceipt: snapshot.baseSnapshot.byteReceipt,
      legalAdvice: false,
      taxAdvice: false,
      decisionAuthority: false,
      automaticAction: false,
      runtimeNetwork: false,
      trialChamberCompatibility: 'unavailable',
    })
    return
  }

  throw new Error(`unknown command ${JSON.stringify(command)}\n\n${HELP}`)
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exitCode = 1
}
