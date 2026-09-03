// Prueba live del endpoint vision: node test/test-frames.js <thumb1.jpg> [thumb2.jpg ...]
// Levantar antes: npm run start:dev  (usa GEMINI_API_KEY del .env)
import { readFile } from 'node:fs/promises';

const BASE = process.env.BACKEND_URL || 'http://localhost:3000';
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Uso: node test/test-frames.js <thumb1.jpg> [thumb2.jpg ...]');
  process.exit(1);
}

const frames = [];
for (let i = 0; i < files.length; i++) {
  const buf = await readFile(files[i]);
  if (buf.length > 280_000) {
    console.error(`${files[i]} pesa ${buf.length}B (>280KB). Baja la resolución a ~320px.`);
    process.exit(1);
  }
  frames.push({
    id: `test_f${String(i + 1).padStart(2, '0')}`,
    timestamp: i * 10.0,
    clipId: 'clip_01',
    beatId: 'beat_1',
    role: i === 0 ? 'hook' : 'story',
    imageBase64: buf.toString('base64'),
  });
}

console.log(`Enviando ${frames.length} frames a ${BASE}/api/v1/clips/analyze-frames ...`);
const t0 = Date.now();
const res = await fetch(`${BASE}/api/v1/clips/analyze-frames`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ videoId: 'live-test', language: 'es', frames }),
});
const ms = Date.now() - t0;
console.log(`HTTP ${res.status} en ${ms}ms`);
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
