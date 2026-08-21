import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { ROOT, readJson, sha256Bytes, sha256Json } from '../src/io.mjs'
import { buildSnapshot, expectedReceipts } from '../src/transformation.mjs'
import { loadSchema, schemaDocumentIssues, validateWithSchema } from '../src/schema-validator.mjs'

test('the sole Draft 2020-12 schema is closed, supported and exactly receipt-pinned', () => {
  const schema = loadSchema()
  const bytes = readFileSync(join(ROOT, 'schemas', 'v0.1', 'public-snapshot.schema.json'))
  assert.deepEqual(readdirSync(join(ROOT, 'schemas', 'v0.1')).sort(), ['public-snapshot.schema.json'])
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(schema.$id, 'https://thekingdom.dev/government/transformations/schemas/v0.1/public-snapshot.schema.json')
  assert.deepEqual(schemaDocumentIssues(schema), [])
  assert.equal(sha256Bytes(bytes), expectedReceipts.schemaByte)
  assert.equal(sha256Json(schema), expectedReceipts.schemaCanonical)
})

test('closed schema validates the deterministic snapshot and rejects count, boundary and unknown-field drift', () => {
  const schema = loadSchema()
  const snapshot = buildSnapshot()
  assert.deepEqual(validateWithSchema(snapshot, schema), [])

  const mutations = [
    (value) => { value.counts.dossiers = 4 },
    (value) => { value.boundaries.approval = true },
    (value) => { value.dossiers[0].approval = false },
    (value) => { value.dossiers[0].planeAssessments[0].status = 'approved' },
    (value) => { value.dossiers[0].preferredOptionId = 'option:invented' },
    (value) => { value.dossiers[0].actionArrays.implementation.push('action:invented') },
    (value) => { value.dossiers[0].proposition.humanReviewed = true },
  ]
  for (const mutate of mutations) {
    const value = structuredClone(snapshot)
    mutate(value)
    assert.notDeepEqual(validateWithSchema(value, schema), [])
  }
})

test('schema meta-validator fails closed on keyword, type and object-contract weakening', () => {
  const base = loadSchema()
  const mutations = [
    (schema) => { delete schema.$defs.dossier.additionalProperties },
    (schema) => { delete schema.$defs.dossier.type },
    (schema) => { schema.$defs.dossier.required.pop() },
    (schema) => { schema.$defs.dossier.required = 'id' },
    (schema) => { delete schema.properties.dossiers.items },
    (schema) => { schema.properties.dossiers.items = true },
    (schema) => { schema.$defs.planeAssessment.properties.status.enum = 'not-assessed' },
    (schema) => { schema.$defs.dossier.properties.options = {} },
    (schema) => { schema.$defs.nonempty = {} },
    (schema) => { schema.$defs.nonempty = false },
    (schema) => { schema.$defs.dossier.unevaluatedProperties = true },
    (schema) => { schema.$defs.dossier.$id = 'https://example.invalid/nested' },
    (schema) => { schema.description = { unsafe: true } },
  ]
  for (const mutate of mutations) {
    const schema = structuredClone(base)
    mutate(schema)
    assert.notDeepEqual(schemaDocumentIssues(schema), [])
  }
})

test('schema closes every declared object and constrains every array item', () => {
  const schema = loadSchema()
  const visit = (node, path = '$') => {
    if (node === null || typeof node !== 'object') return
    if (!Array.isArray(node) && node.type === 'object') {
      assert.equal(node.additionalProperties, false, path)
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path)
    }
    if (!Array.isArray(node) && node.type === 'array') assert.equal(node.items !== undefined, true, path)
    for (const [key, child] of Object.entries(node)) visit(child, `${path}/${key}`)
  }
  visit(schema)
})

test('package is private, unlicensed, zero-dependency and supports Node 20+', () => {
  const pkg = readJson(join(ROOT, 'package.json'))
  assert.equal(pkg.private, true)
  assert.equal(pkg.version, '0.1.0')
  assert.equal(pkg.license, 'UNLICENSED')
  assert.equal(pkg.engines.node, '>=20')
  assert.equal(Object.hasOwn(pkg, 'dependencies'), false)
  assert.equal(Object.hasOwn(pkg, 'devDependencies'), false)
})

test('CI actions are commit-pinned and validate Node 20 and 22', () => {
  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'validate.yml'), 'utf8')
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/u)
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/u)
  assert.match(workflow, /node-version: \["20", "22"\]/u)
  assert.match(workflow, /npm run build:check/u)
})
