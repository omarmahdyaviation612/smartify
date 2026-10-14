const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { inspectObject } = require('./upload-core-textbooks-r2.cjs');
const bytes = Buffer.from('%PDF-test');
const sha = createHash('sha256').update(bytes).digest('hex');
test('absent object is ready; access failures are not absence', async () => {
  assert.equal(await inspectObject({ send: async () => { throw Object.assign(new Error(), { name: 'NotFound' }); } }, 'bucket', 'core.pdf', sha, bytes.length), 'READY_TO_UPLOAD');
  await assert.rejects(inspectObject({ send: async () => { throw Object.assign(new Error(), { name: 'AccessDenied' }); } }, 'bucket', 'core.pdf', sha, bytes.length));
});
test('existing bytes must match; all inspection commands are read-only', async () => {
  for (const identical of [true, false]) {
    const client = { send: async command => {
      if (command.constructor.name === 'HeadObjectCommand') return { ContentLength: bytes.length, ETag: 'etag' };
      assert.equal(command.constructor.name, 'GetObjectCommand');
      assert.equal(command.input.IfMatch, 'etag');
      return { Body: (async function* () { yield identical ? bytes : Buffer.from('%PDF-diff'); })() };
    } };
    assert.equal(await inspectObject(client, 'bucket', 'core.pdf', sha, bytes.length), identical ? 'ALREADY_PRESENT' : 'CONFLICT');
  }
});
