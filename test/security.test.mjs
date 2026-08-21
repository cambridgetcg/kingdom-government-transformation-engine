import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { PUBLIC_SNAPSHOT, ROOT } from '../src/io.mjs'
import { buildSnapshot } from '../src/transformation.mjs'

const SOURCE_FILES = readdirSync(join(ROOT, 'src'))
  .filter((name) => name.endsWith('.mjs'))
  .sort()
  .map((name) => ({ name, text: readFileSync(join(ROOT, 'src', name), 'utf8') }))

test('production imports only bounded Node built-ins and local modules', () => {
  const allowedBuiltins = new Set(['node:crypto', 'node:fs', 'node:path', 'node:url'])
  for (const { name, text } of SOURCE_FILES) {
    const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/gu)].map((match) => match[1])
    for (const specifier of imports) {
      assert.equal(specifier.startsWith('./') || specifier.startsWith('../') || allowedBuiltins.has(specifier), true, `${name}: ${specifier}`)
    }
  }
})

test('production contains no network, subprocess, environment, dynamic-code or credential door', () => {
  const source = SOURCE_FILES.map(({ name, text }) => `\n${name}\n${text}`).join('\n')
  const forbidden = [
    /\bfetch\s*\(/u,
    /\bXMLHttpRequest\b/u,
    /\bWebSocket\b/u,
    /\bEventSource\b/u,
    /node:(?:http|https|net|tls|dgram|dns|child_process|cluster|worker_threads|vm)/u,
    /\b(?:exec|execFile|spawn|fork)Sync?\s*\(/u,
    /\bprocess\.env\b/u,
    /\beval\s*\(/u,
    /\bnew\s+Function\b/u,
    /\bWebAssembly\b/u,
    /\bnpm\s+(?:install|exec|publish)\b/u,
  ]
  for (const pattern of forbidden) assert.doesNotMatch(source, pattern)
})

test('the sole production write target is fixed to public/transformations.json', () => {
  const source = SOURCE_FILES.map(({ text }) => text).join('\n')
  const io = readFileSync(join(ROOT, 'src', 'io.mjs'), 'utf8')
  const cli = readFileSync(join(ROOT, 'src', 'cli.mjs'), 'utf8')
  assert.match(io, /PUBLIC_SNAPSHOT = join\(ROOT, 'public', 'transformations\.json'\)/u)
  assert.match(io, /export function atomicWritePublicSnapshot\(text, operations = \{\}\)/u)
  assert.doesNotMatch(source.replace(io, ''), /\b(?:writeFile|appendFile|openSync|writeSync|renameSync|mkdirSync)\b/u)
  assert.doesNotMatch(cli, /--output/u)
})

test('CLI exposes only help, validate, build, check and overview', () => {
  const before = readFileSync(PUBLIC_SNAPSHOT)
  const publicDirectory = join(ROOT, 'public')
  const temporaryBefore = readdirSync(publicDirectory).filter((name) => name.endsWith('.tmp')).sort()
  for (const safe of ['validate', 'check', 'overview', 'help']) {
    const result = spawnSync(process.execPath, ['src/cli.mjs', safe], { cwd: ROOT, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  for (const command of ['poll', 'fetch', 'run', 'execute', 'decide', 'approve', 'deploy', 'sign', 'file', 'pay', 'post', 'mcp', 'llm']) {
    const result = spawnSync(process.execPath, ['src/cli.mjs', command], { cwd: ROOT, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /unknown command/u)
  }
  const arbitraryOutput = spawnSync(process.execPath, ['src/cli.mjs', 'build', '--output', '/tmp/elsewhere'], { cwd: ROOT, encoding: 'utf8' })
  assert.notEqual(arbitraryOutput.status, 0)
  assert.match(arbitraryOutput.stderr, /unexpected argument/u)
  assert.deepEqual(readFileSync(PUBLIC_SNAPSHOT), before)
  assert.deepEqual(readdirSync(publicDirectory).filter((name) => name.endsWith('.tmp')).sort(), temporaryBefore)
})

test('public output carries no personal records, credentials, case payloads, forms or operational fields', () => {
  const snapshot = buildSnapshot()
  const forbiddenKeys = new Set([
    'address', 'caseId', 'credential', 'credentialValue', 'email', 'fullName', 'nationalInsuranceNumber',
    'partyId', 'personId', 'phone', 'signature', 'taxpayerId', 'transactionId', 'userId',
  ])
  const inspect = (value, path = '$') => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) return value.forEach((child, index) => inspect(child, `${path}/${index}`))
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `${path}/${key}`)
      inspect(child, `${path}/${key}`)
    }
  }
  inspect(snapshot)
  assert.equal(snapshot.boundaries.personalDataCollection, false)
  assert.equal(snapshot.boundaries.publicForm, false)
  assert.equal(snapshot.boundaries.submissions, false)
  assert.equal(snapshot.boundaries.credentialAccess, false)
  assert.equal(snapshot.boundaries.credentialCollection, false)
})

test('TaxSorted remains transitive receipt-bound context with no copied graph, source body or runtime URL', () => {
  const text = readFileSync(PUBLIC_SNAPSHOT, 'utf8')
  assert.doesNotMatch(text, /api\.taxsorted\.io/u)
  for (const key of ['recordText', 'recordLabel', 'providerText', 'fullText', 'rawBody', 'sourceBody']) {
    assert.doesNotMatch(text, new RegExp(`"${key}"\\s*:`, 'u'))
  }
  const snapshot = JSON.parse(text)
  assert.equal(snapshot.dossiers.flatMap((dossier) => dossier.externalContext).every((context) => context.supportsClaimIds.length === 0), true)
})

test('public contract exposes no pass, approval, score, ranking or readiness state', () => {
  const text = readFileSync(PUBLIC_SNAPSHOT, 'utf8')
  for (const key of ['approved', 'authorised', 'eligible', 'funded', 'lawful', 'pass', 'rank', 'rating', 'ready', 'recommendation', 'score']) {
    assert.doesNotMatch(text, new RegExp(`"${key}"\\s*:`, 'u'))
  }
  const snapshot = JSON.parse(text)
  assert.equal(snapshot.boundaries.approval, false)
  assert.equal(snapshot.boundaries.scoring, false)
  assert.equal(snapshot.boundaries.ranking, false)
  assert.equal(snapshot.boundaries.preferredOptionSelection, false)
})

test('no POST, MCP, LLM, runtime network or external effect is represented', () => {
  const snapshot = buildSnapshot()
  assert.equal(snapshot.boundaries.runtimeFetch, false)
  assert.equal(snapshot.boundaries.networkAtBuildOrRuntime, false)
  assert.equal(snapshot.boundaries.llmRuntime, false)
  assert.equal(snapshot.boundaries.mcpExposure, false)
  assert.equal(snapshot.boundaries.externalEffects, false)
  assert.equal(snapshot.boundaries.automatedAction, false)
  assert.equal(snapshot.boundaries.automatedDecision, false)
  assert.equal(snapshot.dossiers.every((dossier) => Object.values(dossier.actionArrays).every((actions) => actions.length === 0)), true)
})
