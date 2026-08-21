import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import {
  PUBLIC_SNAPSHOT,
  ROOT,
  canonicalJson,
  prettyCanonicalJson,
  readJson,
  sha256Bytes,
  sha256Json,
} from '../src/io.mjs'
import {
  BASE_BYTE_RECEIPT,
  BASE_CANONICAL_RECEIPT,
  buildSnapshot,
  freshnessStateFor,
  validateCheckedInSnapshot,
} from '../src/transformation.mjs'

const SNAPSHOT_BYTE_RECEIPT = 'sha256:fef3ca1719cb7fd02c09c558db6f239cad29a173b921763a10a59e042a4cdf00'
const SNAPSHOT_CANONICAL_RECEIPT = 'sha256:7d9df6d5b6292b46abfbc076847f7e033b8d889be7a868dcbeac5d901b75c715'
const PLANE_IDS = ['plane:delivery', 'plane:jurisdiction', 'plane:law', 'plane:mandate', 'plane:money', 'plane:remedy']

function reaches(graph, fromId, predicate) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  const outgoing = new Map()
  for (const edge of graph.edges) outgoing.set(edge.fromId, [...(outgoing.get(edge.fromId) ?? []), edge.toId])
  const pending = [...(outgoing.get(fromId) ?? [])]
  const seen = new Set()
  while (pending.length > 0) {
    const id = pending.shift()
    if (predicate(nodes.get(id))) return true
    if (seen.has(id)) continue
    seen.add(id)
    pending.push(...(outgoing.get(id) ?? []))
  }
  return false
}

test('Phase-0 output is exact, synthetic, held and incapable of authority or external effects', () => {
  const snapshot = buildSnapshot()
  assert.equal(snapshot.dossiers.length, 3)
  assert.equal(Object.values(snapshot.boundaries).every((value) => value === false), true)
  assert.equal(snapshot.adoption.state, 'not-adopted')
  assert.equal(snapshot.adoption.authorityLocation, 'outside-this-system')
  assert.equal(snapshot.authorship.origin, 'maintainer-authorized-assisted-publication')
  assert.equal(snapshot.authorship.compiledBy, 'codex-assisted-publication')
  assert.equal(snapshot.authorship.humanDirectionRecorded, true)
  assert.equal(snapshot.authorship.exactTextHumanReviewed, false)
  assert.equal(snapshot.authorship.humanReviewRequired, true)
  assert.equal(snapshot.authorship.humanReviewCompleted, false)
  for (const dossier of snapshot.dossiers) {
    assert.equal(dossier.synthetic, true)
    assert.match(dossier.title, /^Synthetic /u)
    assert.equal(dossier.hold.state, 'held')
    assert.equal(dossier.hold.stopsProgression, true)
    assert.equal(dossier.selectionState, 'not-selected')
    assert.equal(dossier.preferredOptionId, null)
    assert.equal(Object.values(dossier.actionArrays).every((actions) => actions.length === 0), true)
    assert.equal(dossier.trialChamber.compatibility, 'unavailable')
    assert.equal(dossier.trialChamber.result, null)
    assert.equal(dossier.trialChamber.useAsAuthority, false)
  }
})

test('exact vendored Government Engine admission binds bytes, canonical form and dereferenceable provenance', () => {
  const snapshot = buildSnapshot()
  assert.equal(snapshot.baseSnapshot.bytes, 196005)
  assert.equal(snapshot.baseSnapshot.byteReceipt, BASE_BYTE_RECEIPT)
  assert.equal(snapshot.baseSnapshot.canonicalReceipt, BASE_CANONICAL_RECEIPT)
  assert.equal(snapshot.baseSnapshot.canonicalUrl, 'https://thekingdom.dev/government/uk-government-engine-2026-08-21.json')
  assert.equal(snapshot.baseSnapshot.schemaUrl, 'https://thekingdom.dev/government/schemas/v0.1/public-snapshot.schema.json')
  assert.equal(snapshot.baseSnapshot.guideUrl, 'https://thekingdom.dev/UK-GOVERNMENT-ENGINE-v0.1.md')
  assert.equal(snapshot.baseSnapshot.path, 'vendor/government-engine/government-2026-08-21.json')
  assert.deepEqual([...snapshot.baseSnapshot.planeIds], PLANE_IDS)
  assert.equal(snapshot.baseSnapshot.officialSourceHandling, 'link-only')
  assert.equal(snapshot.baseSnapshot.exactTextHumanReviewed, false)
  assert.equal(snapshot.baseSnapshot.runtimeFetch, false)
})

test('every evidence atom pins an exact admitted base ID without generic host trust or a conclusion', () => {
  const snapshot = buildSnapshot()
  const base = readJson(join(ROOT, 'vendor', 'government-engine', 'government-2026-08-21.json'))
  const typed = new Map([
    ['body', new Set(base.bodies.map((record) => record.id))],
    ['claim', new Set(base.claims.map((record) => record.id))],
    ['flow', new Set(base.flows.map((record) => record.id))],
    ['plane', new Set(base.planes.map((record) => record.id))],
    ['rail', new Set(base.rails.map((record) => record.id))],
    ['redressRoute', new Set(base.redressRoutes.map((record) => record.id))],
    ['relation', new Set(base.relations.map((record) => record.id))],
    ['source', new Set(base.sources.map((record) => record.id))],
    ['unknown', new Set(base.unknowns.map((record) => record.id))],
  ])
  for (const dossier of snapshot.dossiers) {
    const atoms = new Map(dossier.evidenceAtoms.map((atom) => [atom.id, atom]))
    for (const atom of dossier.evidenceAtoms) {
      assert.equal(typed.get(atom.baseEntityType).has(atom.baseEntityId), true, atom.id)
      assert.equal(atom.baseSnapshotByteReceipt, BASE_BYTE_RECEIPT)
      assert.equal(atom.baseSnapshotCanonicalReceipt, BASE_CANONICAL_RECEIPT)
      assert.equal(atom.baseSnapshotCanonicalUrl, snapshot.baseSnapshot.canonicalUrl)
      assert.equal(atom.officialSourceHandling, 'link-only')
      assert.equal(atom.exactTextHumanReviewed, false)
      assert.equal(atom.genericOfficialHostTrust, false)
      assert.equal(atom.supportsConclusion, false)
      assert.equal(atom.evidenceUse, 'orientation-only')
    }
    const used = new Set(dossier.planeAssessments.flatMap((assessment) => assessment.evidenceAtomIds))
    assert.deepEqual([...used].sort(), [...atoms.keys()].sort())
  }
})

test('each dossier has exactly six held plane assessments and no shipped orientation-supported result', () => {
  const snapshot = buildSnapshot()
  const allowed = new Set(['not-assessed', 'insufficient-evidence', 'contested', 'specialist-review-required', 'orientation-supported'])
  for (const dossier of snapshot.dossiers) {
    assert.equal(dossier.planeAssessments.length, 6)
    assert.deepEqual(dossier.planeAssessments.map((assessment) => assessment.planeId).sort(), PLANE_IDS)
    assert.equal(dossier.planeAssessments.every((assessment) => allowed.has(assessment.status)), true)
    assert.equal(dossier.planeAssessments.every((assessment) => assessment.status !== 'orientation-supported'), true)
    assert.equal(dossier.planeAssessments.every((assessment) => assessment.unresolvedQuestionIds.length > 0), true)
    assert.equal(dossier.humanGates.every((gate) => gate.required && !gate.completed && gate.authorityOutsideSystem), true)
  }
})

test('authority graphs cover all six planes and define prerequisite direction without automatic progression', () => {
  const snapshot = buildSnapshot()
  const types = new Set()
  for (const dossier of snapshot.dossiers) {
    assert.equal(dossier.authorityDependencyGraph.automaticProgression, false)
    assert.deepEqual([...new Set(dossier.authorityDependencyGraph.nodes.map((node) => node.planeId))].sort(), PLANE_IDS)
    const ids = new Set(dossier.authorityDependencyGraph.nodes.map((node) => node.id))
    for (const edge of dossier.authorityDependencyGraph.edges) {
      types.add(edge.type)
      assert.equal(ids.has(edge.fromId), true)
      assert.equal(ids.has(edge.toId), true)
      assert.notEqual(edge.fromId, edge.toId)
    }
  }
  assert.deepEqual([...types].sort(), ['alternative', 'does-not-imply', 'feedback', 'parallel', 'prerequisite'])
  const money = snapshot.dossiers.find((dossier) => dossier.id === 'dossier:public-money-transparency-information-service')
  const edge = money.authorityDependencyGraph.edges.find((candidate) => candidate.id === 'dependency:money-law-prerequisite')
  assert.equal(edge.fromId, 'law:instrument-question')
  assert.equal(edge.toId, 'money:authority-question')
})

test('causal graphs keep BAU and alternatives on distinct hypothetical paths with explicit edge direction', () => {
  const snapshot = buildSnapshot()
  for (const dossier of snapshot.dossiers) {
    const graph = dossier.causalChangeHypothesisGraph
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
    const options = new Map(dossier.options.map((option) => [option.id, option]))
    assert.equal(graph.claimsCausalTruth, false)
    const outputs = new Set()
    for (const intervention of graph.nodes.filter((node) => node.type === 'intervention-option')) {
      const targets = graph.edges
        .filter((edge) => edge.fromId === intervention.id && edge.type === 'hypothesises-contribution')
        .map((edge) => nodes.get(edge.toId))
        .filter((node) => node.type === 'output')
      assert.equal(targets.length, 1, intervention.id)
      assert.equal(outputs.has(targets[0].id), false, intervention.id)
      outputs.add(targets[0].id)
      const reachesOutcome = reaches(graph, targets[0].id, (node) => node?.type === 'desired-outcome')
      assert.equal(reachesOutcome, options.get(intervention.optionId).kind === 'alternative', intervention.id)
    }
    for (const edge of graph.edges) {
      if (edge.type === 'depends-on') assert.deepEqual([nodes.get(edge.fromId).type, nodes.get(edge.toId).type], ['desired-outcome', 'assumption'])
      if (edge.type === 'may-undermine') assert.deepEqual([nodes.get(edge.fromId).type, nodes.get(edge.toId).type], ['negative-pathway', 'desired-outcome'])
      if (edge.type === 'tests') assert.deepEqual([nodes.get(edge.fromId).type, nodes.get(edge.toId).type], ['evaluation-need', 'desired-outcome'])
    }
  }
})

test('frozen propositions are cross-bound, non-personal, unofficial and canonically receipted', () => {
  const snapshot = buildSnapshot()
  for (const dossier of snapshot.dossiers) {
    const { canonicalReceipt, ...input } = dossier.proposition
    assert.equal(dossier.proposition.dossierId, dossier.id)
    assert.equal(dossier.proposition.kind, 'synthetic-exemplar')
    assert.equal(dossier.proposition.personalDataPresent, false)
    assert.equal(dossier.proposition.officialProposal, false)
    assert.equal(dossier.proposition.humanReviewed, false)
    assert.equal(dossier.proposition.outOfScope.length >= 3, true)
    assert.equal(canonicalReceipt, sha256Json(input))
  }
})

test('category-error contract keeps money, authority, delivery, evidence and freshness vocabularies distinct', () => {
  const snapshot = buildSnapshot()
  const pairs = new Set(snapshot.categoryErrorRules.map((rule) => `${rule.left}!=${rule.right}`))
  for (const pair of [
    'mandate!=legal-power', 'topic!=legislative-or-executive-competence', 'guidance!=law',
    'forecast!=authority', 'plan!=estimate', 'estimate!=appropriation', 'appropriation!=credit',
    'appropriation!=issue', 'issue!=outturn', 'payment-or-settlement!=liability',
    'payment-or-settlement!=spending-power', 'payment-rail!=authority', 'service-or-api!=decision-authority',
    'complaint!=appeal-or-deadline-protection', 'external-crosswalk!=official-evidence', 'freshness!=legal-effect',
  ]) assert.equal(pairs.has(pair), true, pair)
  assert.equal(snapshot.categoryErrorRules.every((rule) => rule.relation === 'does-not-imply'), true)
})

test('TaxSorted appears only through exact admitted external-context IDs and supports no claim', () => {
  const snapshot = buildSnapshot()
  const contexts = snapshot.dossiers.flatMap((dossier) => dossier.externalContext)
  assert.equal(contexts.length, 4)
  assert.deepEqual(contexts.map((context) => context.recordId).sort(), [
    'gap-pooled-pound-traceability', 'mechanism-parliamentary-supply', 'stage-review-and-appeal', 'stage-service-complaint',
  ])
  for (const context of contexts) {
    assert.deepEqual([...context.supportsClaimIds], [])
    assert.equal(context.taint, 'external-context-only')
    assert.equal(context.baseSnapshotByteReceipt, BASE_BYTE_RECEIPT)
    assert.equal(context.baseSnapshotCanonicalUrl, snapshot.baseSnapshot.canonicalUrl)
  }
})

test('public-money dossier holds labelled-pound tracing and distinguishes payment rails from authority', () => {
  const snapshot = buildSnapshot()
  const dossier = snapshot.dossiers.find((record) => record.id === 'dossier:public-money-transparency-information-service')
  assert.equal(dossier.hold.reasonCode, 'labelled-pound-traceability-not-established')
  assert.equal(dossier.evidenceAtoms.some((atom) => atom.baseEntityId === 'unknown:public-money-trace'), true)
  for (const id of ['claim:money-estimates', 'claim:money-parliamentary-authority', 'claim:money-gbs', 'claim:delivery-pay', 'claim:money-rtgs-chaps']) {
    assert.equal(dossier.evidenceAtoms.some((atom) => atom.baseEntityId === id), true, id)
  }
})

test('four-nation dossier keeps England, Scotland, Wales and Northern Ireland distinct behind specialist review', () => {
  const snapshot = buildSnapshot()
  const dossier = snapshot.dossiers.find((record) => record.id === 'dossier:four-nation-public-service-information')
  assert.deepEqual(dossier.jurisdictionBranches.map((branch) => branch.jurisdiction).sort(), ['England', 'Northern Ireland', 'Scotland', 'Wales'])
  assert.equal(dossier.jurisdictionBranches.every((branch) => branch.status === 'specialist-review-required'), true)
  assert.equal(dossier.hold.reasonCode, 'four-nation-specialist-competence-review-required')
})

test('HMRC notice dossier keeps complaint, review, appeal and judicial review parallel without determinations', () => {
  const snapshot = buildSnapshot()
  const dossier = snapshot.dossiers.find((record) => record.id === 'dossier:hmrc-decision-notice-explanatory-content')
  assert.deepEqual(dossier.routeOrientations.map((route) => route.baseRedressRouteId).sort(), [
    'redress:hmrc-service-complaint', 'redress:hmrc-statutory-review', 'redress:judicial-review-england-wales', 'redress:tax-tribunal-appeal',
  ])
  for (const route of dossier.routeOrientations) {
    assert.equal(route.relationship, 'parallel')
    assert.equal(route.routeDetermined, false)
    assert.equal(route.deadlineDetermined, false)
    assert.equal(route.eligibilityDetermined, false)
  }
  assert.equal(dossier.planeAssessments.every((assessment) => assessment.status !== 'orientation-supported'), true)
  assert.equal(dossier.hold.reasonCode, 'route-deadline-and-eligibility-insufficient-evidence')
})

test('freshness is truthful: historical bytes reproduce while release state hard-quarantines after deadline', () => {
  const snapshot = buildSnapshot()
  assert.equal(snapshot.freshness.stateAtPublication, 'within-review-window')
  assert.equal(snapshot.freshness.automaticRuntimeEnforcement, false)
  assert.equal(snapshot.freshness.readerTimeStateNotEmbedded, true)
  assert.equal(snapshot.freshness.immutableAfterDeadline, 'historical-orientation-only')
  assert.equal(snapshot.freshness.mutableAliasPolicy, 'retire-or-replace')
  assert.deepEqual(freshnessStateFor(new Date('2026-09-21T23:59:59Z')), {
    evaluatedOn: '2026-09-21', nextReviewDue: '2026-09-21', state: 'within-review-window', orientationAvailable: true,
  })
  assert.deepEqual(freshnessStateFor(new Date('2026-09-22T00:00:00Z')), {
    evaluatedOn: '2026-09-22', nextReviewDue: '2026-09-21', state: 'hard-quarantined', orientationAvailable: false,
  })
  assert.equal(canonicalJson(buildSnapshot()), canonicalJson(snapshot))
})

test('publication URLs are exact and producer provenance points to the immutable release tag', () => {
  const urls = buildSnapshot().urls
  assert.equal(urls.human, 'https://thekingdom.dev/government-transformation-engine/')
  assert.equal(urls.mutableAlias, 'https://thekingdom.dev/government-transformations.json')
  assert.equal(urls.canonical, 'https://thekingdom.dev/government/uk-government-transformation-engine-2026-08-21.json')
  assert.equal(urls.schema, 'https://thekingdom.dev/government/transformations/schemas/v0.1/public-snapshot.schema.json')
  assert.equal(urls.guide, 'https://thekingdom.dev/UK-GOVERNMENT-TRANSFORMATION-ENGINE-v0.1.md')
  assert.equal(urls.producer, 'https://github.com/cambridgetcg/kingdom-government-transformation-engine/tree/v0.1.0')
})

test('checked-in output is the exact canonical build', () => {
  const snapshot = buildSnapshot()
  const bytes = readFileSync(PUBLIC_SNAPSHOT)
  assert.equal(bytes.toString('utf8'), prettyCanonicalJson(snapshot))
  assert.equal(sha256Bytes(bytes), SNAPSHOT_BYTE_RECEIPT)
  assert.equal(sha256Json(snapshot), SNAPSHOT_CANONICAL_RECEIPT)
  assert.equal(validateCheckedInSnapshot().current, true)
  assert.equal(canonicalJson(readJson(PUBLIC_SNAPSHOT)), canonicalJson(snapshot))
})
