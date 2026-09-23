const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual helper without importing the seed entry point or Prisma.
const source = fs.readFileSync(path.join(__dirname, 'seed-titles-from-manifests.js'), 'utf8');
const start = source.indexOf('async function upsertSubject(');
const end = source.indexOf('\n// Same backfill', start);
assert.ok(start >= 0 && end > start);

function harness(existing) {
  const writes = [];
  const subject = {
    findFirst: async () => existing,
    update: async args => { writes.push({ method: 'update', ...args }); return Object.assign(existing, args.data); },
    create: async args => { writes.push({ method: 'create', ...args }); return { id: 'subject-1', ...args.data }; },
  };
  const context = { prisma: { subject } };
  vm.runInNewContext(source.slice(start, end), context);
  return { writes, run: value => context.upsertSubject('grade-3', 'English Language', 'English', null, value) };
}

for (const old of [null, '']) {
  test(`backfills ${JSON.stringify(old)} once and remains idempotent`, async () => {
    const h = harness({ id: 'subject-1', sourceFile: old });
    assert.equal((await h.run('ENGLISH Y3.pdf')).sourceFile, 'ENGLISH Y3.pdf');
    await h.run('ENGLISH Y3.pdf');
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].method, 'update');
    assert.deepEqual(Object.keys(h.writes[0].data), ['sourceFile']);
  });
}
for (const old of ['british-intl/grade-3/english-language/english-y3.pdf', 'OTHER BOOK.pdf', ' ']) {
  test(`preserves nonempty mapping ${JSON.stringify(old)} exactly`, async () => {
    const h = harness({ id: 'subject-1', sourceFile: old });
    assert.equal((await h.run('ENGLISH Y3.pdf')).sourceFile, old);
    assert.equal(h.writes.length, 0);
  });
}
test('missing manifest source does not update an existing subject', async () => {
  const h = harness({ id: 'subject-1', sourceFile: null });
  for (const value of [null, undefined, '']) await h.run(value);
  assert.equal(h.writes.length, 0);
});
test('new subject still receives its manifest source or null', async () => {
  for (const value of ['ENGLISH Y3.pdf', undefined]) {
    const h = harness(null);
    assert.equal((await h.run(value)).sourceFile, value ?? null);
    assert.equal(h.writes[0].method, 'create');
    assert.equal(h.writes[0].data.gradeId, 'grade-3');
  }
});
