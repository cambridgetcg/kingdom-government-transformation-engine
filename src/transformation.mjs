import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  PUBLIC_SNAPSHOT,
  ROOT,
  atomicWritePublicSnapshot,
  canonicalJson,
  parseJsonBytes,
  prettyCanonicalJson,
  readBoundedBytes,
  readJson,
  sha256Bytes,
  sha256Json,
} from './io.mjs'
import { loadSchema, schemaDocumentIssues, validateWithSchema } from './schema-validator.mjs'

const CONFIG_RECEIPT = 'sha256:24cf7e2f470ba154a956c1665e9b4a130497410428720e521c6d3b8af34b8c4d'
const DOSSIERS_RECEIPT = 'sha256:5e487ca2f1938bcaf8da13ca1db956eb356f587eade6a92ce179f70686759929'
const BASE_PATH = join(ROOT, 'vendor', 'government-engine', 'government-2026-08-21.json')
export const BASE_BYTE_RECEIPT = 'sha256:1751b2ac331d6a1283cbf57b5b6961d9071f528298f97589fcbd7cf36407e139'
export const BASE_CANONICAL_RECEIPT = 'sha256:cc2c22e356cef0160ed5da1e2fd756bad5801f574c4cb064dec157b9207b9739'
const BASE_BYTES = 196_005
const BASE_CANONICAL_URL = 'https://thekingdom.dev/government/uk-government-engine-2026-08-21.json'
const BASE_SCHEMA_URL = 'https://thekingdom.dev/government/schemas/v0.1/public-snapshot.schema.json'
const BASE_GUIDE_URL = 'https://thekingdom.dev/UK-GOVERNMENT-ENGINE-v0.1.md'
const SCHEMA_PATH = join(ROOT, 'schemas', 'v0.1', 'public-snapshot.schema.json')
const SCHEMA_BYTE_RECEIPT = 'sha256:9949457e87db784c734b195195c7f3cdc2afb138ada400f61583ebd0a6cf7be6'
const SCHEMA_CANONICAL_RECEIPT = 'sha256:b7118c1cd2f226b276b02f21bb080d3e3e5aae6aa26bc03e74277a5d1844c5c9'

const PLANE_IDS = Object.freeze([
  'plane:delivery',
  'plane:jurisdiction',
  'plane:law',
  'plane:mandate',
  'plane:money',
  'plane:remedy',
])
const DOSSIER_IDS = Object.freeze([
  'dossier:four-nation-public-service-information',
  'dossier:hmrc-decision-notice-explanatory-content',
  'dossier:public-money-transparency-information-service',
])
const STATUS_VALUES = new Set([
  'not-assessed',
  'insufficient-evidence',
  'contested',
  'specialist-review-required',
  'orientation-supported',
])
const DEPENDENCY_TYPES = new Set(['prerequisite', 'parallel', 'alternative', 'feedback', 'does-not-imply'])
const CAUSAL_NODE_TYPES = new Set([
  'intervention-option', 'assumption', 'output', 'desired-outcome', 'negative-pathway', 'evaluation-need',
])
const CAUSAL_EDGE_TYPES = new Set(['hypothesises-contribution', 'depends-on', 'may-undermine', 'tests'])
const BANNED_SCALAR_KEYS = new Set([
  'approval', 'approved', 'authorised', 'eligible', 'funded', 'lawful', 'pass', 'rank', 'rating', 'ready', 'recommendation', 'score',
])

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortedStrings(values) {
  return [...values].sort(compareAscii)
}

function sortedRecords(values) {
  return [...values].sort((left, right) => compareAscii(left.id, right.id))
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
}

function exactValue(value, expected) {
  return canonicalJson(value) === canonicalJson(expected)
}

function semantic(message) {
  return `semantic: ${message}`
}

function uniqueIds(records, label, issues) {
  const ids = records.map((record) => record?.id)
  if (ids.some((id) => typeof id !== 'string' || id.length < 3)) issues.push(semantic(`${label} contains an invalid ID`))
  if (new Set(ids).size !== ids.length) issues.push(semantic(`${label} IDs must be unique`))
  return new Set(ids)
}

function collectBannedKeys(value, path = '$', issues = []) {
  if (value === null || typeof value !== 'object') return issues
  if (Array.isArray(value)) {
    value.forEach((child, index) => collectBannedKeys(child, `${path}/${index}`, issues))
    return issues
  }
  for (const [key, child] of Object.entries(value)) {
    const explicitFalseBoundary = path === '$/config/boundaries' && child === false
    if (BANNED_SCALAR_KEYS.has(key) && !explicitFalseBoundary) issues.push(semantic(`${path}/${key}: forbidden decision or scalar field`))
    collectBannedKeys(child, `${path}/${key}`, issues)
  }
  return issues
}

function graphReachable(edges, fromId, targetPredicate) {
  const outgoing = new Map()
  for (const edge of edges) {
    const next = outgoing.get(edge.fromId) ?? []
    next.push(edge.toId)
    outgoing.set(edge.fromId, next)
  }
  const visited = new Set([fromId])
  const pending = [...(outgoing.get(fromId) ?? [])]
  while (pending.length > 0) {
    const current = pending.shift()
    if (targetPredicate(current)) return true
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...(outgoing.get(current) ?? []))
  }
  return false
}

function normalize(value) {
  if (Array.isArray(value)) {
    const children = value.map((child) => normalize(child))
    if (children.every((child) => typeof child === 'string')) return sortedStrings(children)
    if (children.every((child) => child !== null && typeof child === 'object' && typeof child.id === 'string')) return sortedRecords(children)
    return children
  }
  if (value === null || typeof value !== 'object') return value
  const output = Object.create(null)
  for (const [key, child] of Object.entries(value)) output[key] = normalize(child)
  return output
}

function admissionForBase(base, baseBytes) {
  const issues = []
  if (baseBytes.byteLength !== BASE_BYTES) issues.push(semantic('base snapshot byte length differs from the admitted immutable receipt'))
  if (sha256Bytes(baseBytes) !== BASE_BYTE_RECEIPT) issues.push(semantic('base snapshot bytes differ from the admitted immutable receipt'))
  if (sha256Json(base) !== BASE_CANONICAL_RECEIPT) issues.push(semantic('base snapshot canonical form differs from the admitted immutable receipt'))
  if (base.schema !== 'kingdom.government-engine-public-snapshot/0.1' || base.contractVersion !== '0.1.0') {
    issues.push(semantic('base Government Engine contract identity mismatch'))
  }
  if (base.asOf !== '2026-08-21' || base.freshness?.nextReviewDue !== '2026-09-21') {
    issues.push(semantic('base Government Engine date or review-window binding mismatch'))
  }
  if (base.urls?.canonical !== BASE_CANONICAL_URL || base.urls?.guide !== BASE_GUIDE_URL) issues.push(semantic('base canonical or guide URL mismatch'))
  if (base.authorship?.exactTextHumanReviewed !== false
    || base.sourceLedgerPolicy?.integrity?.exactTextHumanReviewed !== false
    || base.sourceLedgerPolicy?.rights?.publicationMode !== 'link-only') {
    issues.push(semantic('base official-source review and link-only boundary mismatch'))
  }
  if (!exactValue(sortedStrings(base.planes?.map((plane) => plane.id) ?? []), PLANE_IDS)) {
    issues.push(semantic('base Government Engine must expose the six exact admitted planes'))
  }
  if (base.externalBridges?.some((bridge) => bridge.boundaries?.governmentEvidenceSource !== false
    || bridge.boundaries?.official !== false || bridge.boundaries?.runtimeDataTransfer !== false)) {
    issues.push(semantic('base external bridge boundary mismatch'))
  }
  return issues
}

export function loadInputs() {
  const config = readJson(join(ROOT, 'data', 'config.json'))
  const dossiers = readJson(join(ROOT, 'data', 'dossiers.json'))
  const baseBytes = readBoundedBytes(BASE_PATH)
  const base = parseJsonBytes(baseBytes, 'admitted Government Engine snapshot')
  if (!Array.isArray(dossiers)) throw new TypeError('data/dossiers.json must contain an array')
  return { config, dossiers, base, baseBytes }
}

function baseInventory(base) {
  const typed = new Map()
  const all = new Set()
  const mappings = {
    body: base.bodies,
    claim: base.claims,
    flow: base.flows,
    plane: base.planes,
    rail: base.rails,
    redressRoute: base.redressRoutes,
    relation: base.relations,
    source: base.sources,
    unknown: base.unknowns,
  }
  for (const [type, records] of Object.entries(mappings)) {
    const ids = new Set(records.map((record) => record.id))
    typed.set(type, ids)
    for (const id of ids) all.add(id)
  }
  return { typed, all }
}

function bridgeBindingInventory(base) {
  const bindings = new Set()
  for (const bridge of base.externalBridges) {
    for (const binding of bridge.selectedRecordBindings) {
      bindings.add(`${bridge.id}\u0000${binding.collection}\u0000${binding.recordId}`)
    }
  }
  return bindings
}

function dossierIssues(dossier, base) {
  const issues = []
  const inventory = baseInventory(base)
  const atoms = uniqueIds(dossier.evidenceAtoms ?? [], `${dossier.id}.evidenceAtoms`, issues)
  const assessments = uniqueIds(dossier.planeAssessments ?? [], `${dossier.id}.planeAssessments`, issues)
  const options = uniqueIds(dossier.options ?? [], `${dossier.id}.options`, issues)
  const gates = uniqueIds(dossier.humanGates ?? [], `${dossier.id}.humanGates`, issues)

  if (dossier.synthetic !== true || !dossier.title?.startsWith('Synthetic ')) issues.push(semantic(`${dossier.id}: dossier must be visibly synthetic`))
  const proposition = dossier.proposition ?? {}
  if (proposition.dossierId !== dossier.id || proposition.kind !== 'synthetic-exemplar'
    || proposition.personalDataPresent !== false || proposition.officialProposal !== false || proposition.humanReviewed !== false
    || proposition.sourceAuthorship !== 'codex-assisted-publication-under-recorded-human-direction'
    || typeof proposition.verbatimStatement !== 'string' || proposition.verbatimStatement.length < 40
    || !Array.isArray(proposition.outOfScope) || proposition.outOfScope.length < 3
    || !Array.isArray(proposition.affectedTerritories) || proposition.affectedTerritories.length < 1) {
    issues.push(semantic(`${dossier.id}: frozen synthetic proposition boundary or cross-binding mismatch`))
  }
  if (!exactValue(dossier.adoption, { authorityLocation: 'outside-this-system', state: 'not-adopted' })) issues.push(semantic(`${dossier.id}: adoption must remain outside this system and not adopted`))
  if (dossier.preferredOptionId !== null || dossier.selectionState !== 'not-selected') issues.push(semantic(`${dossier.id}: no preferred option may be selected`))
  if (!exactValue(dossier.trialChamber, { compatibility: 'unavailable', result: null, useAsAuthority: false })) issues.push(semantic(`${dossier.id}: Trial Chamber compatibility must remain unavailable and non-authoritative`))
  if (dossier.hold?.state !== 'held' || dossier.hold?.stopsProgression !== true) issues.push(semantic(`${dossier.id}: a hard hold must stop progression`))
  if (!exactKeys(dossier.actionArrays ?? {}, ['decision', 'evaluation', 'implementation', 'operational', 'redress'])
    || Object.values(dossier.actionArrays ?? {}).some((array) => !Array.isArray(array) || array.length !== 0)) {
    issues.push(semantic(`${dossier.id}: every action array must exist and remain deny-all empty`))
  }
  const optionRecords = dossier.options ?? []
  if (optionRecords.length < 3 || optionRecords.filter((option) => option.kind === 'business-as-usual').length !== 1
    || optionRecords.filter((option) => option.kind === 'alternative').length < 2
    || optionRecords.some((option) => option.selected !== false)) {
    issues.push(semantic(`${dossier.id}: options require one BAU, at least two alternatives and no selection`))
  }
  if ((dossier.desiredOutcomes ?? []).length < 1) issues.push(semantic(`${dossier.id}: a desired outcome hypothesis is required`))
  if (gates.size < 1 || dossier.humanGates.some((gate) => gate.required !== true || gate.completed !== false || gate.authorityOutsideSystem !== true)) {
    issues.push(semantic(`${dossier.id}: human gates must be required, incomplete and outside-system`))
  }

  const planeAssessments = dossier.planeAssessments ?? []
  if (planeAssessments.length !== 6 || !exactValue(sortedStrings(planeAssessments.map((assessment) => assessment.planeId)), PLANE_IDS)) {
    issues.push(semantic(`${dossier.id}: must contain exactly one assessment for each admitted base plane`))
  }
  for (const assessment of planeAssessments) {
    if (!STATUS_VALUES.has(assessment.status)) issues.push(semantic(`${assessment.id}: forbidden plane assessment status`))
    if (assessment.status === 'specialist-review-required' && assessment.specialistReviewRequired !== true) issues.push(semantic(`${assessment.id}: specialist status must require specialist review`))
    if (assessment.status === 'orientation-supported'
      && (assessment.specialistReviewRequired === true || assessment.unresolvedQuestionIds?.length > 0
        || dossier.humanGates.some((gate) => gate.completed !== true && gate.planeIds.includes(assessment.planeId))
        || assessment.evidenceAtomIds.some((id) => dossier.evidenceAtoms.find((atom) => atom.id === id)?.supportsConclusion !== true))) {
      issues.push(semantic(`${assessment.id}: orientation-supported conflicts with an unresolved question, incomplete gate or non-supporting evidence`))
    }
    if (!Array.isArray(assessment.evidenceAtomIds) || assessment.evidenceAtomIds.length < 1
      || assessment.evidenceAtomIds.some((id) => !atoms.has(id))) issues.push(semantic(`${assessment.id}: evidence atom reference mismatch`))
    if (!Array.isArray(assessment.unresolvedQuestionIds) || assessment.unresolvedQuestionIds.length < 1) issues.push(semantic(`${assessment.id}: unresolved questions must remain visible`))
  }

  const usedAtoms = new Set(planeAssessments.flatMap((assessment) => assessment.evidenceAtomIds))
  if (!exactValue(sortedStrings([...usedAtoms]), sortedStrings([...atoms]))) issues.push(semantic(`${dossier.id}: every evidence atom must be used by a plane assessment`))
  for (const atom of dossier.evidenceAtoms ?? []) {
    if (atom.officialSourceHandling !== 'link-only' || atom.exactTextHumanReviewed !== false
      || atom.genericOfficialHostTrust !== false || atom.supportsConclusion !== false) {
      issues.push(semantic(`${atom.id}: evidence handling must remain link-only, non-conclusive and not exact-text human-reviewed`))
    }
    if (!inventory.typed.get(atom.baseEntityType)?.has(atom.baseEntityId)) issues.push(semantic(`${atom.id}: unknown or mistyped admitted base entity ${atom.baseEntityId}`))
  }

  const dependency = dossier.authorityDependencyGraph ?? {}
  const dependencyNodes = uniqueIds(dependency.nodes ?? [], `${dossier.id}.authorityDependencyGraph.nodes`, issues)
  uniqueIds(dependency.edges ?? [], `${dossier.id}.authorityDependencyGraph.edges`, issues)
  if (dependency.automaticProgression !== false) issues.push(semantic(`${dossier.id}: authority dependencies cannot imply automatic progression`))
  if (!exactValue(sortedStrings([...new Set((dependency.nodes ?? []).map((node) => node.planeId))]), PLANE_IDS)) issues.push(semantic(`${dossier.id}: authority graph must cover all six exact planes`))
  for (const node of dependency.nodes ?? []) {
    if (!assessments.has(node.assessmentId) || !PLANE_IDS.includes(node.planeId)) issues.push(semantic(`${node.id}: authority node assessment or plane mismatch`))
    if (!Array.isArray(node.baseEntityIds) || node.baseEntityIds.length < 1 || node.baseEntityIds.some((id) => !inventory.all.has(id))) issues.push(semantic(`${node.id}: authority node contains an unknown base ID`))
  }
  for (const edge of dependency.edges ?? []) {
    if (!dependencyNodes.has(edge.fromId) || !dependencyNodes.has(edge.toId) || edge.fromId === edge.toId) issues.push(semantic(`${edge.id}: invalid authority dependency endpoint`))
    if (!DEPENDENCY_TYPES.has(edge.type)) issues.push(semantic(`${edge.id}: invalid authority dependency type`))
  }

  const causal = dossier.causalChangeHypothesisGraph ?? {}
  const causalNodes = uniqueIds(causal.nodes ?? [], `${dossier.id}.causalChangeHypothesisGraph.nodes`, issues)
  uniqueIds(causal.edges ?? [], `${dossier.id}.causalChangeHypothesisGraph.edges`, issues)
  if (causal.claimsCausalTruth !== false) issues.push(semantic(`${dossier.id}: causal graph must remain explicitly hypothetical`))
  for (const node of causal.nodes ?? []) {
    if (!CAUSAL_NODE_TYPES.has(node.type)) issues.push(semantic(`${node.id}: invalid causal node type`))
    if (node.type === 'intervention-option') {
      if (!options.has(node.optionId)) issues.push(semantic(`${node.id}: causal intervention must bind an option`))
    } else if (node.optionId !== null) issues.push(semantic(`${node.id}: only intervention nodes may bind options`))
  }
  const causalTypes = new Set((causal.nodes ?? []).map((node) => node.type))
  for (const required of ['assumption', 'desired-outcome', 'evaluation-need', 'negative-pathway', 'output']) {
    if (!causalTypes.has(required)) issues.push(semantic(`${dossier.id}: causal graph lacks ${required}`))
  }
  for (const edge of causal.edges ?? []) {
    if (!causalNodes.has(edge.fromId) || !causalNodes.has(edge.toId) || edge.fromId === edge.toId) issues.push(semantic(`${edge.id}: invalid causal edge endpoint`))
    if (!CAUSAL_EDGE_TYPES.has(edge.type)) issues.push(semantic(`${edge.id}: invalid causal edge type`))
    const fromType = (causal.nodes ?? []).find((node) => node.id === edge.fromId)?.type
    const toType = (causal.nodes ?? []).find((node) => node.id === edge.toId)?.type
    if (edge.type === 'depends-on' && (fromType !== 'desired-outcome' || toType !== 'assumption')) issues.push(semantic(`${edge.id}: depends-on direction must be desired-outcome to assumption`))
    if (edge.type === 'may-undermine' && (fromType !== 'negative-pathway' || toType !== 'desired-outcome')) issues.push(semantic(`${edge.id}: may-undermine direction must be negative-pathway to desired-outcome`))
    if (edge.type === 'tests' && (fromType !== 'evaluation-need' || toType !== 'desired-outcome')) issues.push(semantic(`${edge.id}: tests direction must be evaluation-need to desired-outcome`))
  }
  const nodeById = new Map((causal.nodes ?? []).map((node) => [node.id, node]))
  const optionById = new Map(optionRecords.map((option) => [option.id, option]))
  const causalEdges = causal.edges ?? []
  const distinctOutputs = new Set()
  for (const intervention of (causal.nodes ?? []).filter((node) => node.type === 'intervention-option')) {
    const directOutputs = causalEdges
      .filter((edge) => edge.fromId === intervention.id && edge.type === 'hypothesises-contribution')
      .map((edge) => nodeById.get(edge.toId))
      .filter((node) => node?.type === 'output')
    if (directOutputs.length !== 1) issues.push(semantic(`${intervention.id}: each option must lead to exactly one distinct hypothesised output`))
    if (directOutputs[0] !== undefined) {
      if (distinctOutputs.has(directOutputs[0].id)) issues.push(semantic(`${intervention.id}: options cannot jointly cause one output`))
      distinctOutputs.add(directOutputs[0].id)
      const reachesDesiredOutcome = graphReachable(causalEdges, directOutputs[0].id, (id) => nodeById.get(id)?.type === 'desired-outcome')
      if (optionById.get(intervention.optionId)?.kind === 'business-as-usual' && reachesDesiredOutcome) issues.push(semantic(`${intervention.id}: BAU comparator cannot feed the desired intervention outcome`))
      if (optionById.get(intervention.optionId)?.kind === 'alternative' && !reachesDesiredOutcome) issues.push(semantic(`${intervention.id}: alternative hypothesis must explicitly connect its distinct output to a desired outcome`))
    }
  }
  for (const outcome of dossier.desiredOutcomes ?? []) {
    for (const [key, type] of [['assumptionNodeIds', 'assumption'], ['negativePathwayNodeIds', 'negative-pathway'], ['evaluationNeedNodeIds', 'evaluation-need']]) {
      if (!Array.isArray(outcome[key]) || outcome[key].length < 1 || outcome[key].some((id) => nodeById.get(id)?.type !== type)) issues.push(semantic(`${outcome.id}: ${key} reference mismatch`))
    }
  }

  const baseBindings = bridgeBindingInventory(base)
  const bridgeById = new Map(base.externalBridges.map((bridge) => [bridge.id, bridge]))
  for (const context of dossier.externalContext ?? []) {
    const bindingKey = `${context.bridgeId}\u0000${context.collection}\u0000${context.recordId}`
    if (!baseBindings.has(bindingKey) || !bridgeById.has(context.bridgeId)) issues.push(semantic(`${dossier.id}: external context is not an exact admitted base bridge binding`))
    if (context.taint !== 'external-context-only' || !Array.isArray(context.supportsClaimIds) || context.supportsClaimIds.length !== 0) issues.push(semantic(`${dossier.id}: external context cannot support a claim`))
  }
  return issues
}

export function semanticIssues(inputs) {
  const { config, dossiers, base, baseBytes } = inputs
  const issues = []
  if (sha256Json(config) !== CONFIG_RECEIPT) issues.push(semantic('config differs from the reviewed canonical receipt'))
  if (sha256Json(dossiers) !== DOSSIERS_RECEIPT) issues.push(semantic('dossiers differ from the reviewed canonical receipt'))
  issues.push(...admissionForBase(base, baseBytes))
  if (!exactValue(sortedStrings(dossiers.map((dossier) => dossier.id)), DOSSIER_IDS)) issues.push(semantic('exact synthetic dossier inventory mismatch'))
  if (config.asOf !== base.asOf || config.freshness?.nextReviewDue !== base.freshness?.nextReviewDue
    || config.freshness?.inheritsBaseReviewWindow !== true || config.freshness?.expiredState !== 'hard-quarantined-historical-only'
    || config.freshness?.automaticRuntimeEnforcement !== false || config.freshness?.readerTimeStateNotEmbedded !== true
    || config.freshness?.releaseGateRequired !== true || config.freshness?.mutableAliasPolicy !== 'retire-or-replace') {
    issues.push(semantic('freshness must inherit the exact base review window and hard-quarantine expiry'))
  }
  if (config.authorship?.origin !== 'maintainer-authorized-assisted-publication'
    || config.authorship?.compiledBy !== 'codex-assisted-publication'
    || config.authorship?.humanDirectionRecorded !== true
    || config.authorship?.exactTextHumanReviewed !== false
    || config.authorship?.humanReviewRequired !== true || config.authorship?.humanReviewCompleted !== false) {
    issues.push(semantic('truthful assisted authorship or incomplete human-review boundary mismatch'))
  }
  if (Object.values(config.boundaries ?? {}).some((value) => value !== false)) issues.push(semantic('all capability and authority boundaries must remain false'))
  if (!exactValue(config.adoption, { authorityLocation: 'outside-this-system', state: 'not-adopted' })) issues.push(semantic('top-level adoption boundary mismatch'))
  if (!exactValue(config.trialChamber, { compatibility: 'unavailable', result: null, useAsAuthority: false })) issues.push(semantic('top-level Trial Chamber boundary mismatch'))
  const categoryPairs = new Set(config.categoryErrorRules?.map((rule) => `${rule.left}\u0000${rule.right}`) ?? [])
  const requiredPairs = [
    ['mandate', 'legal-power'],
    ['topic', 'legislative-or-executive-competence'],
    ['guidance', 'law'],
    ['appropriation', 'credit'],
    ['appropriation', 'issue'],
    ['estimate', 'appropriation'],
    ['forecast', 'appropriation'],
    ['forecast', 'authority'],
    ['issue', 'outturn'],
    ['payment-or-settlement', 'liability'],
    ['payment-or-settlement', 'spending-power'],
    ['plan', 'appropriation'],
    ['plan', 'estimate'],
    ['payment-rail', 'authority'],
    ['service-or-api', 'decision-authority'],
    ['complaint', 'appeal-or-deadline-protection'],
    ['external-crosswalk', 'official-evidence'],
    ['freshness', 'legal-effect'],
  ]
  if (categoryPairs.size !== requiredPairs.length || requiredPairs.some(([left, right]) => !categoryPairs.has(`${left}\u0000${right}`))
    || config.categoryErrorRules?.some((rule) => rule.relation !== 'does-not-imply')) issues.push(semantic('category-error distinction inventory mismatch'))
  for (const dossier of dossiers) issues.push(...dossierIssues(dossier, base))

  const allDependencyTypes = new Set(dossiers.flatMap((dossier) => dossier.authorityDependencyGraph.edges.map((edge) => edge.type)))
  for (const type of DEPENDENCY_TYPES) if (!allDependencyTypes.has(type)) issues.push(semantic(`dependency schema example inventory lacks ${type}`))
  const moneyDependency = dossiers
    .find((dossier) => dossier.id === 'dossier:public-money-transparency-information-service')
    ?.authorityDependencyGraph.edges.find((edge) => edge.id === 'dependency:money-law-prerequisite')
  if (moneyDependency?.type !== 'prerequisite' || moneyDependency?.fromId !== 'law:instrument-question'
    || moneyDependency?.toId !== 'money:authority-question') {
    issues.push(semantic('prerequisite direction is from the legal-instrument question to the public-money question'))
  }
  const fourNation = dossiers.find((dossier) => dossier.id === 'dossier:four-nation-public-service-information')
  if (!exactValue(sortedStrings(fourNation?.jurisdictionBranches?.map((branch) => branch.jurisdiction) ?? []), ['England', 'Northern Ireland', 'Scotland', 'Wales'])
    || fourNation?.jurisdictionBranches?.some((branch) => branch.status !== 'specialist-review-required')) issues.push(semantic('four-nation dossier must expose four distinct specialist-held branches'))
  const notice = dossiers.find((dossier) => dossier.id === 'dossier:hmrc-decision-notice-explanatory-content')
  if (!exactValue(sortedStrings(notice?.routeOrientations?.map((route) => route.baseRedressRouteId) ?? []), [
    'redress:hmrc-service-complaint', 'redress:hmrc-statutory-review', 'redress:judicial-review-england-wales', 'redress:tax-tribunal-appeal',
  ]) || notice?.routeOrientations?.some((route) => route.relationship !== 'parallel' || route.deadlineDetermined !== false
    || route.eligibilityDetermined !== false || route.routeDetermined !== false)
    || notice?.planeAssessments?.some((assessment) => assessment.status === 'orientation-supported' && assessment.planeId !== 'plane:delivery')) {
    issues.push(semantic('HMRC notice dossier must stop at insufficient evidence with non-determinative parallel remedy orientation'))
  }
  issues.push(...collectBannedKeys({ config, dossiers }))
  return [...new Set(issues)].sort()
}

function countsFor(dossiers) {
  const sum = (selector) => dossiers.reduce((count, dossier) => count + selector(dossier).length, 0)
  return {
    authorityDependencyEdges: sum((dossier) => dossier.authorityDependencyGraph.edges),
    authorityDependencyNodes: sum((dossier) => dossier.authorityDependencyGraph.nodes),
    causalEdges: sum((dossier) => dossier.causalChangeHypothesisGraph.edges),
    causalNodes: sum((dossier) => dossier.causalChangeHypothesisGraph.nodes),
    desiredOutcomes: sum((dossier) => dossier.desiredOutcomes),
    dossiers: dossiers.length,
    evidenceAtoms: sum((dossier) => dossier.evidenceAtoms),
    externalContextBindings: sum((dossier) => dossier.externalContext),
    humanGates: sum((dossier) => dossier.humanGates),
    jurisdictionBranches: sum((dossier) => dossier.jurisdictionBranches),
    options: sum((dossier) => dossier.options),
    planeAssessments: sum((dossier) => dossier.planeAssessments),
    routeOrientations: sum((dossier) => dossier.routeOrientations),
  }
}

function enrichDossier(dossier) {
  const normalizedProposition = normalize(dossier.proposition)
  return {
    ...dossier,
    proposition: {
      ...normalizedProposition,
      canonicalReceipt: sha256Json(normalizedProposition),
    },
    evidenceAtoms: dossier.evidenceAtoms.map((atom) => ({
      ...atom,
      baseSnapshotByteReceipt: BASE_BYTE_RECEIPT,
      baseSnapshotCanonicalReceipt: BASE_CANONICAL_RECEIPT,
      baseSnapshotCanonicalUrl: BASE_CANONICAL_URL,
      evidenceUse: 'orientation-only',
    })),
    externalContext: dossier.externalContext.map((context) => ({
      ...context,
      baseSnapshotByteReceipt: BASE_BYTE_RECEIPT,
      baseSnapshotCanonicalReceipt: BASE_CANONICAL_RECEIPT,
      baseSnapshotCanonicalUrl: BASE_CANONICAL_URL,
    })),
  }
}

export function buildSnapshot() {
  const inputs = loadInputs()
  const issues = semanticIssues(inputs)
  if (issues.length !== 0) throw new Error(`transformation input validation failed:\n- ${issues.join('\n- ')}`)
  const { config, dossiers, base } = inputs
  const enriched = dossiers.map((dossier) => enrichDossier(dossier))
  const snapshot = normalize({
    schema: config.schema,
    contractVersion: config.contractVersion,
    title: config.title,
    asOf: config.asOf,
    urls: config.urls,
    jurisdiction: config.jurisdiction,
    authorship: config.authorship,
    adoption: config.adoption,
    boundaries: config.boundaries,
    freshness: {
      ...config.freshness,
      readerTimeBehavior: 'immutable-artifact-remains-available-but-must-be-treated-as-historical-only-after-review-deadline',
    },
    trialChamber: config.trialChamber,
    baseSnapshot: {
      schema: base.schema,
      contractVersion: base.contractVersion,
      asOf: base.asOf,
      nextReviewDue: base.freshness.nextReviewDue,
      path: 'vendor/government-engine/government-2026-08-21.json',
      canonicalUrl: BASE_CANONICAL_URL,
      schemaUrl: BASE_SCHEMA_URL,
      guideUrl: BASE_GUIDE_URL,
      bytes: BASE_BYTES,
      byteReceipt: BASE_BYTE_RECEIPT,
      canonicalReceipt: BASE_CANONICAL_RECEIPT,
      planeIds: PLANE_IDS,
      admissionMode: 'exact-immutable-vendored-snapshot-only',
      officialSourceHandling: 'link-only',
      exactTextHumanReviewed: false,
      runtimeFetch: false,
    },
    categoryErrorRules: config.categoryErrorRules,
    actionArrays: { decision: [], evaluation: [], implementation: [], operational: [], redress: [] },
    dossiers: enriched,
    counts: countsFor(enriched),
    buildProvenance: {
      deterministic: true,
      networkUsed: false,
      inputCanonicalReceipts: { config: CONFIG_RECEIPT, dossiers: DOSSIERS_RECEIPT },
      schemaByteReceipt: SCHEMA_BYTE_RECEIPT,
      schemaCanonicalReceipt: SCHEMA_CANONICAL_RECEIPT,
    },
  })
  const schema = loadSchema()
  const receiptIssues = schemaReceiptIssues(schema)
  if (receiptIssues.length !== 0) throw new Error(`schema receipt validation failed:\n- ${receiptIssues.join('\n- ')}`)
  const schemaIssues = schemaDocumentIssues(schema)
  if (schemaIssues.length !== 0) throw new Error(`schema contract validation failed:\n- ${schemaIssues.join('\n- ')}`)
  const validationIssues = validateWithSchema(snapshot, schema)
  if (validationIssues.length !== 0) throw new Error(`public snapshot schema validation failed:\n- ${validationIssues.join('\n- ')}`)
  return snapshot
}

export function schemaReceiptIssues(schema = loadSchema(), bytes = readBoundedBytes(SCHEMA_PATH)) {
  const issues = []
  if (sha256Bytes(bytes) !== SCHEMA_BYTE_RECEIPT) issues.push('schema byte receipt differs from the frozen contract')
  if (sha256Json(schema) !== SCHEMA_CANONICAL_RECEIPT) issues.push('schema canonical receipt differs from the frozen contract')
  return issues
}

export function freshnessStateFor(date, nextReviewDue = '2026-09-21') {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError('freshness date must be a valid Date')
  const evaluatedOn = date.toISOString().slice(0, 10)
  return {
    evaluatedOn,
    nextReviewDue,
    state: evaluatedOn > nextReviewDue ? 'hard-quarantined' : 'within-review-window',
    orientationAvailable: evaluatedOn <= nextReviewDue,
  }
}

export function assertFreshForRelease(date) {
  const state = freshnessStateFor(date)
  if (!state.orientationAvailable) throw new Error(`HARD_QUARANTINE: admitted base review window ended ${state.nextReviewDue}; a new reviewed snapshot is required`)
  return state
}

export function writeSnapshot() {
  const snapshot = buildSnapshot()
  const text = prettyCanonicalJson(snapshot)
  atomicWritePublicSnapshot(text)
  const bytes = readBoundedBytes(PUBLIC_SNAPSHOT)
  return { path: PUBLIC_SNAPSHOT, snapshot, bytes: bytes.byteLength, byteReceipt: sha256Bytes(bytes), canonicalReceipt: sha256Json(snapshot) }
}

export function validateCheckedInSnapshot() {
  const snapshot = buildSnapshot()
  const expected = prettyCanonicalJson(snapshot)
  if (!existsSync(PUBLIC_SNAPSHOT)) return { current: false, snapshot }
  const bytes = readBoundedBytes(PUBLIC_SNAPSHOT)
  const checked = parseJsonBytes(bytes, 'checked-in transformation snapshot')
  const validationIssues = validateWithSchema(checked)
  if (validationIssues.length !== 0) throw new Error(`checked-in snapshot schema validation failed:\n- ${validationIssues.join('\n- ')}`)
  return {
    current: bytes.equals(Buffer.from(expected, 'utf8')),
    snapshot,
    bytes: bytes.byteLength,
    byteReceipt: sha256Bytes(bytes),
    canonicalReceipt: sha256Json(checked),
  }
}

export const expectedReceipts = Object.freeze({
  baseByte: BASE_BYTE_RECEIPT,
  baseCanonical: BASE_CANONICAL_RECEIPT,
  configCanonical: CONFIG_RECEIPT,
  dossiersCanonical: DOSSIERS_RECEIPT,
  schemaByte: SCHEMA_BYTE_RECEIPT,
  schemaCanonical: SCHEMA_CANONICAL_RECEIPT,
})
