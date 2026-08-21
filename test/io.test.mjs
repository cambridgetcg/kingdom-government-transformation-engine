import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import {
  JSON_LIMITS,
  PUBLIC_SNAPSHOT,
  ROOT,
  assertNoSymlinkComponents,
  atomicWritePublicSnapshot,
  canonicalJson,
  insideRoot,
  parseJsonBytes,
  prettyCanonicalJson,
  sha256Json,
  writeAllBytes,
} from '../src/io.mjs'

test('strict parser rejects duplicate keys, malformed UTF-8, unsafe integers and trailing data', () => {
  assert.throws(() => parseJsonBytes(Buffer.from('{"safe":true,"safe":false}')), /duplicate JSON object key/u)
  assert.throws(() => parseJsonBytes(Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x3a, 0x31, 0x7d])), /encoded data/u)
  assert.throws(() => parseJsonBytes(Buffer.from('{"integer":9007199254740993}')), /unsafe JSON integer/u)
  assert.throws(() => parseJsonBytes(Buffer.from('{}{}')), /trailing data/u)
})

test('strict parser enforces depth, node, collection and string bounds', () => {
  const base = { ...JSON_LIMITS }
  assert.throws(() => parseJsonBytes(Buffer.from('[[[[]]]]'), 'deep', { ...base, depth: 2 }), /nesting exceeds/u)
  assert.throws(() => parseJsonBytes(Buffer.from('[1,2,3]'), 'nodes', { ...base, nodes: 3 }), /node count exceeds/u)
  assert.throws(() => parseJsonBytes(Buffer.from('[1,2,3]'), 'collection', { ...base, collectionItems: 2 }), /array exceeds/u)
  assert.throws(() => parseJsonBytes(Buffer.from('{"long":"abcd"}'), 'string', { ...base, stringCodePoints: 3 }), /string exceeds/u)
})

test('canonical JSON preserves prototype-shaped member names without pollution', () => {
  const hostile = parseJsonBytes(Buffer.from('{"__proto__":{"polluted":true},"constructor":"constructor-data","nested":{"__proto__":{"admin":true},"prototype":"prototype-data"},"safe":1}'))
  const withoutMembers = parseJsonBytes(Buffer.from('{"nested":{},"safe":1}'))
  const canonical = canonicalJson(hostile)

  assert.notEqual(canonical, canonicalJson(withoutMembers))
  assert.notEqual(sha256Json(hostile), sha256Json(withoutMembers))
  assert.match(canonical, /"__proto__":\{"polluted":true\}/u)
  assert.match(canonical, /"constructor":"constructor-data"/u)
  assert.match(canonical, /"prototype":"prototype-data"/u)
  assert.equal(Object.prototype.polluted, undefined)
  assert.equal(Object.prototype.admin, undefined)
})

test('canonical JSON accepts inert null-prototype objects but rejects custom prototypes', () => {
  const inert = Object.create(null)
  inert.safe = true
  assert.equal(canonicalJson(inert), '{"safe":true}')
  assert.equal(prettyCanonicalJson(inert).endsWith('\n'), true)

  const custom = Object.create({ inherited: true })
  custom.safe = true
  assert.throws(() => canonicalJson(custom), /ordinary or null prototype/u)
})

test('bundled-path guard rejects traversal and a simulated symlink ancestor', () => {
  assert.equal(insideRoot(join(ROOT, 'data', 'config.json')), true)
  assert.equal(insideRoot(join(ROOT, '..', 'outside.json')), false)
  const target = join(ROOT, 'data', 'simulated.json')
  const directoryStatus = { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false }
  const symlinkStatus = { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false }
  assert.throws(
    () => assertNoSymlinkComponents(target, (path) => path === join(ROOT, 'data') ? symlinkStatus : directoryStatus),
    /symbolic-link path components are forbidden/u,
  )
})

test('writeAllBytes handles short writes and rejects zero or invalid progress', () => {
  const bytes = Buffer.from('abcdef')
  const calls = []
  const written = writeAllBytes(7, bytes, (descriptor, buffer, offset, length) => {
    calls.push({ descriptor, offset, length, remaining: buffer.length - offset })
    return Math.min(2, length)
  })
  assert.equal(written, bytes.length)
  assert.deepEqual(calls.map((entry) => entry.offset), [0, 2, 4])
  assert.throws(() => writeAllBytes(7, bytes, () => 0), /zero progress/u)
  for (const invalid of [-1, 0.5, bytes.length + 1]) {
    assert.throws(() => writeAllBytes(7, bytes, () => invalid), /invalid or zero progress/u)
  }
})

test('atomic writer never renames after a zero or throwing write', () => {
  for (const failure of [() => 0, () => { throw new Error('injected write failure') }]) {
    let renamed = false
    let closed = 0
    let unlinked = 0
    assert.throws(() => atomicWritePublicSnapshot('{"safe":true}\n', {
      openSync: () => 42,
      writeSync: failure,
      fsyncSync: () => {},
      closeSync: () => { closed += 1 },
      renameSync: () => { renamed = true },
      unlinkSync: () => { unlinked += 1 },
    }), /zero progress|injected write failure/u)
    assert.equal(renamed, false)
    assert.equal(closed, 1)
    assert.equal(unlinked, 1)
  }
})

test('atomic writer completes all short writes, syncs, closes, then renames once', () => {
  const events = []
  atomicWritePublicSnapshot('{"safe":true}\n', {
    openSync: () => { events.push('open'); return 42 },
    writeSync: (descriptor, bytes, offset, length) => { events.push(`write:${offset}`); return Math.min(3, length) },
    fsyncSync: () => { events.push('sync') },
    closeSync: () => { events.push('close') },
    renameSync: () => { events.push('rename') },
    unlinkSync: () => { events.push('unlink') },
  })
  assert.equal(events.filter((entry) => entry === 'rename').length, 1)
  assert.equal(events.indexOf('sync') < events.indexOf('close'), true)
  assert.equal(events.indexOf('close') < events.indexOf('rename'), true)
  assert.equal(events.at(-1), 'unlink')
})

test('fsync, close and rename failures cannot replace public output and still attempt cleanup', () => {
  const before = existsSync(PUBLIC_SNAPSHOT) ? readFileSync(PUBLIC_SNAPSHOT) : null
  const stages = ['fsync', 'close', 'rename']
  for (const stage of stages) {
    let renamed = false
    let unlinked = 0
    let closeCalls = 0
    assert.throws(() => atomicWritePublicSnapshot('{"replacement":true}\n', {
      openSync: () => 42,
      writeSync: (descriptor, bytes, offset, length) => length,
      fsyncSync: () => { if (stage === 'fsync') throw new Error('injected fsync failure') },
      closeSync: () => {
        closeCalls += 1
        if (stage === 'close' && closeCalls === 1) throw new Error('injected close failure')
      },
      renameSync: () => {
        if (stage === 'rename') throw new Error('injected rename failure')
        renamed = true
      },
      unlinkSync: () => { unlinked += 1 },
    }), new RegExp(`injected ${stage} failure`, 'u'))
    assert.equal(renamed, false)
    assert.equal(unlinked, 1)
    assert.equal(closeCalls >= 1, true)
    if (before !== null) assert.deepEqual(readFileSync(PUBLIC_SNAPSHOT), before)
  }
})
