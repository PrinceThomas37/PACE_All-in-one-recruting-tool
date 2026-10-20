// Copies every file in Supabase Storage from the old project to the new one (R-292). Reads the old, writes the new; never deletes.
// Usage: node copy-storage.mjs <oldUrl> <oldServiceKey> <newUrl> <newServiceKey>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const [, , srcUrl, srcKey, dstUrl, dstKey] = process.argv;
if (!srcUrl || !srcKey || !dstUrl || !dstKey) { console.error('usage: copy-storage.mjs <oldUrl> <oldKey> <newUrl> <newKey>'); process.exit(2); }
const src = createClient(srcUrl, srcKey, { auth: { persistSession: false } });
const dst = createClient(dstUrl, dstKey, { auth: { persistSession: false } });

async function listAll(client, bucket, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || !data.length) break;
    for (const it of data) {
      const path = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null || it.id === undefined) out.push(...await listAll(client, bucket, path));     // a folder
      else out.push({ path, size: Number((it.metadata && it.metadata.size) || 0), type: it.metadata && it.metadata.mimetype });
    }
    if (data.length < 1000) break;
  }
  return out;
}

let failed = 0;
const { data: buckets, error: be } = await src.storage.listBuckets();
if (be) { console.error('cannot list the old buckets:', be.message); process.exit(1); }
for (const b of buckets) {
  const have = await dst.storage.getBucket(b.id);
  if (have.error) {
    const made = await dst.storage.createBucket(b.id, { public: !!b.public, fileSizeLimit: b.file_size_limit || undefined, allowedMimeTypes: b.allowed_mime_types || undefined });
    if (made.error) { console.error(`cannot create bucket ${b.id}: ${made.error.message}`); failed++; continue; }
    console.log(`created bucket ${b.id} (${b.public ? 'public' : 'private'})`);
  }
  const files = await listAll(src, b.id);
  let copied = 0, bytes = 0;
  for (const f of files) {
    const got = await src.storage.from(b.id).download(f.path);
    if (got.error) { console.error(`download ${b.id}/${f.path}: ${got.error.message}`); failed++; continue; }
    const buf = Buffer.from(await got.data.arrayBuffer());
    const up = await dst.storage.from(b.id).upload(f.path, buf, { upsert: true, contentType: f.type || got.data.type || 'application/octet-stream' });
    if (up.error) { console.error(`upload ${b.id}/${f.path}: ${up.error.message}`); failed++; continue; }
    copied++; bytes += buf.length;
  }
  const after = await listAll(dst, b.id);
  const same = after.length === files.length && after.reduce((n, x) => n + x.size, 0) === files.reduce((n, x) => n + x.size, 0);
  console.log(`bucket ${b.id}: ${files.length} files in the old, ${after.length} in the new, ${(bytes / 1048576).toFixed(1)} MB copied — ${same ? 'MATCH' : 'DIFFERENT'}`);
  if (!same) failed++;
}
process.exit(failed ? 1 : 0);
