// Local maintenance only. No database imports, application bootstrap or dotenv loading.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const keyFile = path.join(__dirname, '../src/interactive-lesson/unit-grounding/storage/curriculum-source-key.ts');
const keyModule = { exports: {}, require: name => { if (name === 'path') return path; throw Error('Unexpected key-builder dependency'); } };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(keyFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, keyModule);
const { defaultObjectKey } = keyModule.exports;
const digest = data => createHash('sha256').update(data).digest('hex');
const extra = value => String(value).split(/[\\/]/).some(part => part.toLowerCase() === 'extras');

async function inspectObject(client, bucket, key, sha256, size) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (head.ContentLength !== size) return 'CONFLICT';
    // Metadata and ETags alone are not proof of byte identity. Hash the object.
    const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: head.ETag }));
    if (!object.Body) throw Error('Missing response body');
    const hash = createHash('sha256');
    for await (const chunk of object.Body) hash.update(chunk);
    return hash.digest('hex') === sha256 ? 'ALREADY_PRESENT' : 'CONFLICT';
  } catch (error) {
    if (error.name === 'NotFound' || error.name === 'NoSuchKey') return 'READY_TO_UPLOAD';
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--apply-r2' && !a.startsWith('--plan=') && !a.startsWith('--result='))) throw Error('Unknown argument');
  const apply = args.includes('--apply-r2');
  const planPath = path.resolve(args.find(a => a.startsWith('--plan='))?.slice(7) || path.join(__dirname, '../../../docs/core-textbook-repair-plan.json'));
  const resultPath = path.resolve(args.find(a => a.startsWith('--result='))?.slice(9) || path.join(__dirname, '../../../docs/core-textbook-r2-result.json'));
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const env = process.env;
  const configured = env.CURRICULUM_STORAGE_PROVIDER === 's3' && ['CURRICULUM_S3_BUCKET', 'CURRICULUM_S3_ENDPOINT', 'CURRICULUM_S3_ACCESS_KEY_ID', 'CURRICULUM_S3_SECRET_ACCESS_KEY'].every(k => !!env[k]);
  const rows = plan.items.map(i => ({ curriculum: i.curriculumCode, grade: i.gradeNameEn, subject: i.subjectNameEn,
    localFile: i.localPdf, sha256: i.sha256, canonicalR2Key: i.r2Key, finalStatus: 'UNRESOLVED', reason: 'LOCAL_MATCH_NOT_VERIFIED' }));
  const candidates = [];
  const keys = new Set();
  for (let n = 0; n < plan.items.length; n++) {
    const i = plan.items[n], row = rows[n];
    if (i.curriculumCode === 'BRITISH_INTL' && i.gradeLevel === 5 && i.subjectNameEn === 'Mathematics') { row.reason = 'EXCLUDED_UNRESOLVED_YEAR_5_MATHEMATICS'; continue; }
    if (i.localStatus !== 'EXACT_LOCAL_MATCH' || !i.localPdf || !i.sha256 || !['BRITISH_INTL', 'EG_NATIONAL'].includes(i.curriculumCode) || extra(i.localPdf) || extra(i.r2Key) || extra(i.manifestSourceFile)) continue;
    if (!path.isAbsolute(i.localPdf) || path.extname(i.localPdf).toLowerCase() !== '.pdf' ||
        i.r2Key !== defaultObjectKey(i.curriculumCode, i.gradeLevel, i.subjectNameEn, i.manifestSourceFile) || keys.has(i.r2Key)) throw Error('Invalid or duplicate canonical key');
    keys.add(i.r2Key);
    // Revalidate local identity against the reviewed plan, without fuzzy matching.
    if (!fs.existsSync(i.localPdf) || !fs.readdirSync(path.dirname(i.localPdf)).includes(path.basename(i.localPdf))) continue;
    const bytes = fs.readFileSync(i.localPdf);
    if (bytes.length > 200 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== '%PDF-' || digest(bytes) !== i.sha256) { row.reason = 'LOCAL_BYTES_CHANGED'; continue; }
    candidates.push({ i, row, size: bytes.length });
    row.reason = configured ? 'R2_NOT_CHECKED' : 'MISSING_LOCAL_R2_ENVIRONMENT';
  }
  if (resultPath === planPath || candidates.some(c => path.resolve(c.i.localPdf) === resultPath)) throw Error('Unsafe result path');
  const save = () => fs.writeFileSync(resultPath, JSON.stringify({ mode: apply ? 'APPLY_R2' : 'DRY_RUN', totalVerified: candidates.length,
    counts: Object.fromEntries(['ALREADY_PRESENT', 'READY_TO_UPLOAD', 'UPLOADED_VERIFIED', 'CONFLICT', 'UNRESOLVED'].map(s => [s, rows.filter(r => r.finalStatus === s).length])), items: rows }, null, 2) + '\n');
  save();
  if (!configured) { console.log(JSON.stringify({ totalVerified: candidates.length, alreadyPresent: 0, readyToUpload: 0, conflict: 0, unresolved: rows.length, reason: 'MISSING_LOCAL_R2_ENVIRONMENT' })); process.exitCode = 1; return; }
  const client = new S3Client({ region: env.CURRICULUM_S3_REGION || 'auto', endpoint: env.CURRICULUM_S3_ENDPOINT,
    forcePathStyle: env.CURRICULUM_S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: env.CURRICULUM_S3_ACCESS_KEY_ID, secretAccessKey: env.CURRICULUM_S3_SECRET_ACCESS_KEY } });
  try {
    // Inspect the complete plan before considering any uploads.
    for (const { i, row, size } of candidates) {
      try { row.finalStatus = await inspectObject(client, env.CURRICULUM_S3_BUCKET, i.r2Key, i.sha256, size); row.reason = row.finalStatus; }
      catch { row.finalStatus = 'UNRESOLVED'; row.reason = 'R2_CHECK_FAILED'; }
      save();
    }
    if (apply && candidates.some(c => c.row.finalStatus === 'UNRESOLVED')) throw Error('Incomplete object checks');
    if (apply) for (const { i, row, size } of candidates) {
      if (row.finalStatus !== 'READY_TO_UPLOAD') continue;
      try {
        const bytes = fs.readFileSync(i.localPdf);
        if (digest(bytes) !== i.sha256) throw Error('Local file changed');
        try {
          await client.send(new PutObjectCommand({ Bucket: env.CURRICULUM_S3_BUCKET, Key: i.r2Key, Body: bytes,
            ContentType: 'application/pdf', Metadata: { sha256: i.sha256 }, IfNoneMatch: '*' }));
        } catch (error) { if (error.$metadata?.httpStatusCode !== 412) throw error; }
        const status = await inspectObject(client, env.CURRICULUM_S3_BUCKET, i.r2Key, i.sha256, size);
        row.finalStatus = status === 'ALREADY_PRESENT' ? 'UPLOADED_VERIFIED' : status === 'CONFLICT' ? 'CONFLICT' : 'UNRESOLVED';
        row.reason = 'POST_UPLOAD_VERIFICATION';
        if (row.finalStatus !== 'UPLOADED_VERIFIED') throw Error('Verification failed');
      } catch { row.reason = 'UPLOAD_OR_VERIFICATION_FAILED'; if (row.finalStatus !== 'CONFLICT') row.finalStatus = 'UNRESOLVED'; save(); throw Error('Upload stopped'); }
      save();
    }
    console.log(JSON.stringify({ totalVerified: candidates.length, counts: JSON.parse(fs.readFileSync(resultPath)).counts }));
    if (rows.some(r => r.finalStatus === 'CONFLICT' || r.reason === 'R2_CHECK_FAILED')) process.exitCode = 1;
  } finally { client.destroy(); save(); }
}

module.exports = { inspectObject };
if (require.main === module) main().catch(() => { console.error('R2 uploader stopped. Review the result file and local configuration; credentials and raw SDK errors are suppressed.'); process.exitCode = 1; });
