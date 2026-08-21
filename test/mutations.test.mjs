import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { ROOT } from '../src/io.mjs'
import {
  loadInputs,
  schemaReceiptIssues,
  semanticIssues,
} from '../src/transformation.mjs'
import { loadSchema, validateWithSchema } from '../src/schema-validator.mjs'
import { buildSnapshot } from '../src/transformation.mjs'

function issuesAfter(mutate) {
  const inputs = loadInputs()
  mutate(inputs)
  return semanticIssues(inputs).join('\n')
}

function dossier(inputs, id) {
  return inputs.dossiers.find((record) => record.id === id)
}

test('exact input and base receipts reject config, dossier, base object and base-byte drift', () => {
  const mutations = [
    [(inputs) => { inputs.config.asOf = '2026-08-22' }, /config differs from the reviewed canonical receipt/u],
    [(inputs) => { inputs.dossiers[0].title += ' drift' }, /dossiers differ from the reviewed canonical receipt/u],
    [(inputs) => { inputs.base.claims[0].text += ' drift' }, /base snapshot canonical form differs/u],
    [(inputs) => { inputs.baseBytes = Buffer.from(inputs.baseBytes); inputs.baseBytes[100] ^= 1 }, /base snapshot bytes differ/u],
  ]
  for (const [mutate, pattern] of mutations) assert.match(issuesAfter(mutate), pattern)
})

test('schema receipt check catches whitespace-only bytes and semantically valid widening', () => {
  const schema = loadSchema()
  const bytes = readFileSync(join(ROOT, 'schemas', 'v0.1', 'public-snapshot.schema.json'))
  assert.deepEqual(schemaReceiptIssues(schema, bytes), [])
  assert.match(schemaReceiptIssues(schema, Buffer.concat([bytes, Buffer.from('\n')])).join('\n'), /byte receipt differs/u)

  const widened = structuredClone(schema)
  widened.properties.dossiers.maxItems = 4
  assert.deepEqual(validateWithSchema(buildSnapshot(), widened), [])
  assert.match(schemaReceiptIssues(widened, bytes).join('\n'), /canonical receipt differs/u)
})

test('plane inventory, status and orientation-supported cross-field mutations fail closed', () => {
  assert.match(issuesAfter((inputs) => { inputs.dossiers[0].planeAssessments.pop() }), /exactly one assessment for each admitted base plane/u)
  assert.match(issuesAfter((inputs) => { inputs.dossiers[0].planeAssessments[0].status = 'approved' }), /forbidden plane assessment status/u)
  assert.match(issuesAfter((inputs) => { inputs.dossiers[0].planeAssessments[0].status = 'orientation-supported' }), /orientation-supported conflicts/u)
  assert.match(issuesAfter((inputs) => {
    inputs.dossiers[0].planeAssessments[0].status = 'specialist-review-required'
    inputs.dossiers[0].planeAssessments[0].specialistReviewRequired = false
  }), /specialist status must require specialist review/u)
})

test('human gates, adoption, Trial Chamber and deny-all actions cannot acquire authority', () => {
  const mutations = [
    [(inputs) => { inputs.dossiers[0].humanGates[0].completed = true }, /human gates must be required, incomplete and outside-system/u],
    [(inputs) => { inputs.dossiers[0].humanGates[0].required = false }, /human gates must be required/u],
    [(inputs) => { inputs.dossiers[0].adoption.state = 'adopted' }, /adoption must remain outside this system/u],
    [(inputs) => { inputs.dossiers[0].trialChamber.compatibility = 'available' }, /Trial Chamber compatibility must remain unavailable/u],
    [(inputs) => { inputs.dossiers[0].actionArrays.decision.push('action:decide') }, /action array must exist and remain deny-all empty/u],
    [(inputs) => { inputs.dossiers[0].preferredOptionId = inputs.dossiers[0].options[0].id }, /no preferred option may be selected/u],
    [(inputs) => { inputs.dossiers[0].options[0].selected = true }, /no selection/u],
  ]
  for (const [mutate, pattern] of mutations) assert.match(issuesAfter(mutate), pattern)
})

test('explicit false approval boundary is allowed only there and true or dossier fields fail differently', () => {
  const baseline = loadInputs()
  assert.equal(baseline.config.boundaries.approval, false)
  assert.doesNotMatch(semanticIssues(baseline).join('\n'), /forbidden decision or scalar field/u)
  assert.match(issuesAfter((inputs) => { inputs.config.boundaries.approval = true }), /all capability and authority boundaries must remain false/u)
  assert.match(issuesAfter((inputs) => { inputs.dossiers[0].approval = false }), /forbidden decision or scalar field/u)
  assert.match(issuesAfter((inputs) => { inputs.dossiers[0].approval = true }), /forbidden decision or scalar field/u)
})

test('evidence IDs, types, handling and complete use are bound to exact vendored entities', () => {
  const mutations = [
    [(inputs) => { inputs.dossiers[0].evidenceAtoms[0].baseEntityId = 'claim:absent' }, /unknown or mistyped admitted base entity/u],
    [(inputs) => { inputs.dossiers[0].evidenceAtoms[0].baseEntityType = 'body' }, /unknown or mistyped admitted base entity/u],
    [(inputs) => { inputs.dossiers[0].evidenceAtoms[0].officialSourceHandling = 'trusted-host' }, /evidence handling must remain link-only/u],
    [(inputs) => { inputs.dossiers[0].evidenceAtoms[0].exactTextHumanReviewed = true }, /not exact-text human-reviewed/u],
    [(inputs) => { inputs.dossiers[0].evidenceAtoms[0].genericOfficialHostTrust = true }, /evidence handling must remain link-only/u],
    [(inputs) => { inputs.dossiers[0].evidenceAtoms[0].supportsConclusion = true }, /non-conclusive/u],
    [(inputs) => { inputs.dossiers[0].planeAssessments[0].evidenceAtomIds = [inputs.dossiers[0].planeAssessments[0].evidenceAtomIds[0]] }, /every evidence atom must be used/u],
  ]
  for (const [mutate, pattern] of mutations) assert.match(issuesAfter(mutate), pattern)
})

test('external context cannot escape exact admitted base bindings or support claims', () => {
  const mutations = [
    [(inputs) => { dossier(inputs, 'dossier:public-money-transparency-information-service').externalContext[0].recordId = 'unadmitted-record' }, /not an exact admitted base bridge binding/u],
    [(inputs) => { dossier(inputs, 'dossier:public-money-transparency-information-service').externalContext[0].bridgeId = 'bridge:taxsorted-tax-system' }, /not an exact admitted base bridge binding/u],
    [(inputs) => { dossier(inputs, 'dossier:hmrc-decision-notice-explanatory-content').externalContext[0].supportsClaimIds.push('claim:money-hmrc-role') }, /external context cannot support a claim/u],
    [(inputs) => { dossier(inputs, 'dossier:hmrc-decision-notice-explanatory-content').externalContext[0].taint = 'evidence' }, /external context cannot support a claim/u],
    [(inputs) => { dossier(inputs, 'dossier:hmrc-decision-notice-explanatory-content').externalContext[0].recordText = 'forbidden provider text' }, /dossiers differ from the reviewed canonical receipt/u],
  ]
  for (const [mutate, pattern] of mutations) assert.match(issuesAfter(mutate), pattern)
})

test('authority graph rejects absent nodes, wrong plane coverage, automatic progression and reversed prerequisite', () => {
  const mutations = [
    [(inputs) => { inputs.dossiers[0].authorityDependencyGraph.automaticProgression = true }, /cannot imply automatic progression/u],
    [(inputs) => { inputs.dossiers[0].authorityDependencyGraph.edges[0].toId = 'node:absent' }, /invalid authority dependency endpoint/u],
    [(inputs) => { inputs.dossiers[0].authorityDependencyGraph.edges[0].type = 'automatic' }, /invalid authority dependency type/u],
    [(inputs) => { inputs.dossiers[0].authorityDependencyGraph.nodes[0].planeId = 'plane:money' }, /must cover all six exact planes/u],
    [(inputs) => {
      const edge = dossier(inputs, 'dossier:public-money-transparency-information-service').authorityDependencyGraph.edges
        .find((candidate) => candidate.id === 'dependency:money-law-prerequisite')
      ;[edge.fromId, edge.toId] = [edge.toId, edge.fromId]
    }, /prerequisite direction is from the legal-instrument question/u],
  ]
  for (const [mutate, pattern] of mutations) assert.match(issuesAfter(mutate), pattern)
})

test('causal graph rejects shared outputs, BAU contribution to desired outcome and inverted semantic edges', () => {
  const targetId = 'dossier:public-money-transparency-information-service'
  assert.match(issuesAfter((inputs) => {
    const graph = dossier(inputs, targetId).causalChangeHypothesisGraph
    const edges = graph.edges.filter((edge) => edge.fromId.startsWith('causal:money-alt-') && edge.type === 'hypothesises-contribution')
    edges[1].toId = edges[0].toId
  }), /options cannot jointly cause one output/u)
  assert.match(issuesAfter((inputs) => {
    const graph = dossier(inputs, targetId).causalChangeHypothesisGraph
    graph.edges.push({ fromId: 'causal:money-bau-state', id: 'causal-edge:bau-to-outcome-injected', toId: 'causal:money-outcome', type: 'hypothesises-contribution' })
  }), /BAU comparator cannot feed the desired intervention outcome/u)
  for (const edgeType of ['depends-on', 'may-undermine', 'tests']) {
    assert.match(issuesAfter((inputs) => {
      const graph = dossier(inputs, targetId).causalChangeHypothesisGraph
      const edge = graph.edges.find((candidate) => candidate.type === edgeType)
      ;[edge.fromId, edge.toId] = [edge.toId, edge.fromId]
    }), new RegExp(`${edgeType} direction`, 'u'))
  }
})

test('proposition origin, exact statement, cross-binding and non-personal boundary fail closed on drift', () => {
  const mutations = [
    [(inputs) => { inputs.dossiers[0].proposition.dossierId = inputs.dossiers[1].id }, /proposition boundary or cross-binding mismatch/u],
    [(inputs) => { inputs.dossiers[0].proposition.officialProposal = true }, /proposition boundary/u],
    [(inputs) => { inputs.dossiers[0].proposition.personalDataPresent = true }, /proposition boundary/u],
    [(inputs) => { inputs.dossiers[0].proposition.humanReviewed = true }, /proposition boundary/u],
    [(inputs) => { inputs.dossiers[0].proposition.verbatimStatement += ' drift' }, /dossiers differ from the reviewed canonical receipt/u],
  ]
  for (const [mutate, pattern] of mutations) assert.match(issuesAfter(mutate), pattern)
})

test('four-nation and HMRC route-specific holds cannot be collapsed into a generic path', () => {
  assert.match(issuesAfter((inputs) => { dossier(inputs, 'dossier:four-nation-public-service-information').jurisdictionBranches.pop() }), /four distinct specialist-held branches/u)
  assert.match(issuesAfter((inputs) => { dossier(inputs, 'dossier:four-nation-public-service-information').jurisdictionBranches[0].status = 'orientation-supported' }), /four distinct specialist-held branches/u)
  assert.match(issuesAfter((inputs) => { dossier(inputs, 'dossier:hmrc-decision-notice-explanatory-content').routeOrientations[0].deadlineDetermined = true }), /non-determinative parallel remedy orientation/u)
  assert.match(issuesAfter((inputs) => { dossier(inputs, 'dossier:hmrc-decision-notice-explanatory-content').routeOrientations[0].relationship = 'next' }), /non-determinative parallel remedy orientation/u)
})

test('category distinctions and freshness quarantine contract cannot be weakened', () => {
  assert.match(issuesAfter((inputs) => { inputs.config.categoryErrorRules.pop() }), /category-error distinction inventory mismatch/u)
  assert.match(issuesAfter((inputs) => { inputs.config.categoryErrorRules[0].relation = 'implies' }), /category-error distinction inventory mismatch/u)
  assert.match(issuesAfter((inputs) => { inputs.config.freshness.expiredState = 'current' }), /freshness must inherit/u)
  assert.match(issuesAfter((inputs) => { inputs.config.freshness.automaticRuntimeEnforcement = true }), /freshness must inherit/u)
  assert.match(issuesAfter((inputs) => { inputs.config.freshness.mutableAliasPolicy = 'keep-current' }), /freshness must inherit/u)
})
