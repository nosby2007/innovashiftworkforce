import express from 'express';

const app = express();
app.use(express.json());

// ── CORS (dev) ──────────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Public ───────────────────────────────────────────────────────────────────
app.post('/v1/contact', (req, res) => {
  const { name, organization, email, message } = req.body ?? {};
  console.log('[contact]', { name, organization, email, message });
  // TODO Phase 2: write to Firestore / send email via SendGrid
  res.json({ ok: true, message: 'Demo request received. We will be in touch shortly.' });
});

// ── Shift / Attendance / Messages (mirrors Firebase callables) ───────────────
app.post('/v1/shifts/claim',                    (_req, res) => res.json({ ok: true }));
app.post('/v1/attendance/check-in',             (_req, res) => res.json({ ok: true, entryId: 'PLACEHOLDER' }));
app.post('/v1/attendance/check-out',            (_req, res) => res.json({ ok: true }));
app.post('/v1/messages/mark-read',              (_req, res) => res.json({ ok: true }));
app.post('/v1/admin/time-corrections/decision', (_req, res) => res.json({ ok: true }));

// ── Start ────────────────────────────────────────────────────────────────────
const port = process.env.PORT || 8085;
app.listen(port, () => console.log(`Node backend on :${port}`));
