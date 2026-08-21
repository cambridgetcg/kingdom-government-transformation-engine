import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT, canonicalJson, readJson } from './io.mjs'

const SCHEMA_DIR = join(ROOT, 'schemas', 'v0.1')
const SCHEMA_NAME = 'public-snapshot.schema.json'
const SCHEMA_ID = 'https://thekingdom.dev/government/transformations/schemas/v0.1/public-snapshot.schema.json'
const MAX_SCHEMA_DEPTH = 64

function jsonEqual(left, right) {
  try { return canonicalJson(left) === canonicalJson(right) } catch { return false }
}

function typeMatches(value, type) {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return Number.isSafeInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (['string', 'boolean'].includes(type)) return typeof value === type
  return false
}

function pointer(root, fragment) {
  if (fragment === '' || fragment === '#') return root
  if (!fragment.startsWith('#/')) throw new Error(`unsupported schema fragment ${fragment}`)
  let current = root
  for (const raw of fragment.slice(2).split('/')) {
    const token = raw.replaceAll('~1', '/').replaceAll('~0', '~')
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, token)) {
      throw new Error(`unresolved schema fragment ${fragment}`)
    }
    current = current[token]
  }
  return current
}

export function loadSchema() {
  const names = readdirSync(SCHEMA_DIR).filter((entry) => entry.endsWith('.json')).sort()
  if (canonicalJson(names) !== canonicalJson([SCHEMA_NAME])) {
    throw new Error(`schema inventory must contain exactly ${SCHEMA_NAME}`)
  }
  return readJson(join(SCHEMA_DIR, SCHEMA_NAME))
}

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const instant = new Date(Date.UTC(year, month - 1, day))
  return instant.getUTCFullYear() === year && instant.getUTCMonth() === month - 1 && instant.getUTCDate() === day
}

function validDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)) return false
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value
}

function validUri(value) {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function formatMatches(value, format) {
  if (format === 'date') return validDate(value)
  if (format === 'date-time') return validDateTime(value)
  if (format === 'uri') return validUri(value)
  return false
}

function resolveReference(reference, rootSchema) {
  if (reference.startsWith('#')) return pointer(rootSchema, reference)
  if (reference === SCHEMA_ID) return rootSchema
  if (reference.startsWith(`${SCHEMA_ID}#`)) return pointer(rootSchema, reference.slice(SCHEMA_ID.length))
  throw new Error(`unresolved schema reference ${reference}`)
}

function walk(value, schema, path, rootSchema, depth) {
  if (depth > MAX_SCHEMA_DEPTH) return [`${path}: schema nesting exceeds ${MAX_SCHEMA_DEPTH}`]
  if (schema === true) return []
  if (schema === false) return [`${path}: value is forbidden`]
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return [`${path}: invalid schema node`]
  if (typeof schema.$ref === 'string') return walk(value, resolveReference(schema.$ref, rootSchema), path, rootSchema, depth + 1)

  const issues = []
  if (Object.hasOwn(schema, 'const') && !jsonEqual(value, schema.const)) issues.push(`${path}: must equal declared constant`)
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => jsonEqual(item, value))) issues.push(`${path}: value is outside enum`)
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((type) => typeMatches(value, type))) {
      issues.push(`${path}: expected ${types.join('|')}`)
      return issues
    }
  }
  if (typeof value === 'string') {
    const length = [...value].length
    if (schema.minLength !== undefined && length < schema.minLength) issues.push(`${path}: string is too short`)
    if (schema.maxLength !== undefined && length > schema.maxLength) issues.push(`${path}: string is too long`)
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) issues.push(`${path}: string does not match pattern`)
    if (typeof schema.format === 'string' && !formatMatches(value, schema.format)) issues.push(`${path}: string does not match ${schema.format} format`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) issues.push(`${path}: number is below minimum`)
    if (schema.maximum !== undefined && value > schema.maximum) issues.push(`${path}: number is above maximum`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push(`${path}: array has too few items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push(`${path}: array has too many items`)
    if (schema.uniqueItems === true) {
      const keys = value.map((item) => canonicalJson(item))
      if (new Set(keys).size !== keys.length) issues.push(`${path}: array items must be unique`)
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => issues.push(...walk(item, schema.items, `${path}/${index}`, rootSchema, depth + 1)))
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value)
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) issues.push(`${path}: object has too few properties`)
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) issues.push(`${path}: object has too many properties`)
    const properties = schema.properties ?? {}
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) issues.push(`${path}/${required}: required property is missing`)
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        issues.push(...walk(child, properties[key], `${path}/${key}`, rootSchema, depth + 1))
      } else if (schema.additionalProperties === false) {
        issues.push(`${path}/${key}: additional property is forbidden`)
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        issues.push(...walk(child, schema.additionalProperties, `${path}/${key}`, rootSchema, depth + 1))
      }
    }
  }
  return issues
}

function collectReferences(value, references = []) {
  if (value === null || typeof value !== 'object') return references
  if (typeof value.$ref === 'string') references.push(value.$ref)
  for (const child of Object.values(value)) collectReferences(child, references)
  return references
}

function closedObjectIssues(value, path = '$', issues = []) {
  if (value === null || typeof value !== 'object') return issues
  if (!Array.isArray(value) && value.type === 'object' && value.additionalProperties !== false) {
    issues.push(`${path}: object contract must set additionalProperties false`)
  }
  for (const [key, child] of Object.entries(value)) closedObjectIssues(child, `${path}/${key}`, issues)
  return issues
}

const SUPPORTED_KEYWORDS = new Set([
  '$defs', '$id', '$ref', '$schema',
  'additionalProperties', 'const', 'description', 'enum', 'format', 'items',
  'maxItems', 'maxLength', 'maxProperties', 'maximum',
  'minItems', 'minLength', 'minProperties', 'minimum',
  'pattern', 'properties', 'required', 'title', 'type', 'uniqueItems',
])
const SUPPORTED_TYPES = new Set(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'])
const SUPPORTED_FORMATS = new Set(['date', 'date-time', 'uri'])

function supportedVocabularyIssues(schema, path = '$', issues = []) {
  if (schema === true || schema === false) {
    issues.push(`${path}: boolean schema nodes are forbidden by this producer's fail-closed subset`)
    return issues
  }
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    issues.push(`${path}: schema node must be a non-empty object`)
    return issues
  }
  if (Object.keys(schema).length < 1) issues.push(`${path}: empty schema nodes are forbidden by this producer's fail-closed subset`)
  if (path !== '$' && Object.hasOwn(schema, '$id')) issues.push(`${path}/$id: nested schema identities are forbidden by this producer's fail-closed subset`)
  if (path !== '$' && Object.hasOwn(schema, '$schema')) issues.push(`${path}/$schema: nested schema dialect declarations are forbidden by this producer's fail-closed subset`)
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) issues.push(`${path}/${key}: unsupported schema keyword`)
  }
  if (typeof schema.$ref === 'string' && Object.keys(schema).length !== 1) {
    issues.push(`${path}: $ref siblings are forbidden by this producer's fail-closed subset`)
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type]
  for (const type of types) if (!SUPPORTED_TYPES.has(type)) issues.push(`${path}/type: unsupported type ${JSON.stringify(type)}`)
  if (schema.type !== undefined && typeof schema.type !== 'string'
    && (!Array.isArray(schema.type) || schema.type.length < 1 || new Set(schema.type).size !== schema.type.length)) {
    issues.push(`${path}/type: must be a supported string or non-empty unique string array`)
  }
  if (schema.format !== undefined && !SUPPORTED_FORMATS.has(schema.format)) {
    issues.push(`${path}/format: unsupported format ${JSON.stringify(schema.format)}`)
  }
  if (schema.required !== undefined
    && (!Array.isArray(schema.required) || !schema.required.every((entry) => typeof entry === 'string') || new Set(schema.required).size !== schema.required.length)) {
    issues.push(`${path}/required: must be a unique string array`)
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length < 1
    || new Set(schema.enum.map((entry) => canonicalJson(entry))).size !== schema.enum.length)) {
    issues.push(`${path}/enum: must be a non-empty unique array`)
  }
  for (const key of ['title', 'description', '$id', '$schema']) {
    if (schema[key] !== undefined && typeof schema[key] !== 'string') issues.push(`${path}/${key}: must be a string`)
  }
  const objectKeywords = ['properties', 'required', 'additionalProperties', 'minProperties', 'maxProperties']
  const arrayKeywords = ['items', 'minItems', 'maxItems', 'uniqueItems']
  const stringKeywords = ['minLength', 'maxLength', 'pattern', 'format']
  const numericKeywords = ['minimum', 'maximum']
  if (objectKeywords.some((key) => Object.hasOwn(schema, key)) && schema.type !== 'object') {
    issues.push(`${path}: object keywords require type object`)
  }
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) issues.push(`${path}: object schema must be closed with additionalProperties false`)
    if (schema.properties === null || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
      issues.push(`${path}/properties: object schema must declare a properties map`)
    }
    if (!Array.isArray(schema.required)) issues.push(`${path}/required: object schema must declare a required array`)
    if (Array.isArray(schema.required) && schema.properties && typeof schema.properties === 'object') {
      for (const key of schema.required) if (!Object.hasOwn(schema.properties, key)) issues.push(`${path}/required: undeclared property ${JSON.stringify(key)}`)
      if (canonicalJson([...schema.required].sort()) !== canonicalJson(Object.keys(schema.properties).sort())) {
        issues.push(`${path}: closed object properties and required members must match exactly`)
      }
    }
  }
  if (arrayKeywords.some((key) => Object.hasOwn(schema, key)) && schema.type !== 'array') {
    issues.push(`${path}: array keywords require type array`)
  }
  if (schema.type === 'array' && (schema.items === undefined || schema.items === true || schema.items === false
    || schema.items === null || typeof schema.items !== 'object' || Array.isArray(schema.items) || Object.keys(schema.items).length < 1)) {
    issues.push(`${path}/items: array schema must declare a non-empty object schema`)
  }
  if (stringKeywords.some((key) => Object.hasOwn(schema, key)) && schema.type !== 'string') {
    issues.push(`${path}: string keywords require type string`)
  }
  if (numericKeywords.some((key) => Object.hasOwn(schema, key)) && !['integer', 'number'].includes(schema.type)) {
    issues.push(`${path}: numeric bounds require integer or number type`)
  }
  for (const key of ['minItems', 'maxItems', 'minLength', 'maxLength', 'minProperties', 'maxProperties']) {
    if (schema[key] !== undefined && (!Number.isSafeInteger(schema[key]) || schema[key] < 0)) issues.push(`${path}/${key}: must be a non-negative safe integer`)
  }
  for (const key of ['minimum', 'maximum']) {
    if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) {
      issues.push(`${path}/${key}: must be a finite number`)
    }
  }
  if (typeof schema.minimum === 'number' && typeof schema.maximum === 'number' && schema.minimum > schema.maximum) {
    issues.push(`${path}: minimum exceeds maximum`)
  }
  if (schema.minItems !== undefined && schema.maxItems !== undefined && schema.minItems > schema.maxItems) issues.push(`${path}: minItems exceeds maxItems`)
  if (schema.minLength !== undefined && schema.maxLength !== undefined && schema.minLength > schema.maxLength) issues.push(`${path}: minLength exceeds maxLength`)
  if (schema.minProperties !== undefined && schema.maxProperties !== undefined && schema.minProperties > schema.maxProperties) issues.push(`${path}: minProperties exceeds maxProperties`)
  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean') issues.push(`${path}/uniqueItems: must be boolean`)
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') issues.push(`${path}/pattern: must be a string`)
    else try { new RegExp(schema.pattern, 'u') } catch { issues.push(`${path}/pattern: invalid regular expression`) }
  }
  if (schema.$ref !== undefined && typeof schema.$ref !== 'string') issues.push(`${path}/$ref: must be a string`)
  for (const mapKey of ['$defs', 'properties']) {
    if (schema[mapKey] !== undefined) {
      if (schema[mapKey] === null || typeof schema[mapKey] !== 'object' || Array.isArray(schema[mapKey])) {
        issues.push(`${path}/${mapKey}: must be an object map`)
      } else {
        for (const [key, child] of Object.entries(schema[mapKey])) {
          supportedVocabularyIssues(child, `${path}/${mapKey}/${key}`, issues)
        }
      }
    }
  }
  if (schema.items !== undefined) supportedVocabularyIssues(schema.items, `${path}/items`, issues)
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties === 'object') {
    supportedVocabularyIssues(schema.additionalProperties, `${path}/additionalProperties`, issues)
  }
  return issues
}

export function schemaDocumentIssues(schema = loadSchema()) {
  const issues = []
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') issues.push('unsupported or missing $schema')
  if (schema.$id !== SCHEMA_ID) issues.push(`$id must equal ${SCHEMA_ID}`)
  if (schema.type !== 'object' || schema.additionalProperties !== false) issues.push('root object must be closed')
  if (schema.$defs === null || typeof schema.$defs !== 'object' || Array.isArray(schema.$defs)) issues.push('$defs must be an object')
  issues.push(...supportedVocabularyIssues(schema))
  issues.push(...closedObjectIssues(schema))
  for (const reference of collectReferences(schema)) {
    try { resolveReference(reference, schema) } catch (error) { issues.push(error.message) }
  }
  return [...new Set(issues)].sort()
}

export function validateWithSchema(value, schema = loadSchema()) {
  return walk(value, schema, '$', schema, 0)
}
