import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import OpenAI from 'openai';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { Proposal, buildProposal } from '../domain/ai-proposals';
import { sendPushToUids } from '../infra/push';
import { deriveUnderstaffingTrend, UnderstaffingTrend } from '../domain/understaffing-trend';

const openaiApiKey = defineSecret('OPENAI_API_KEY');

// Keep in sync with the MODEL constant in callable/aiAssistantChat.ts.
const MODEL = 'gpt-5.6';
const LOOKAHEAD_MS = 3 * 24 * 60 * 60 * 1000; // shifts starting in the next 3 days
const OPEN_STATUSES = new Set(['draft', 'open', 'published']);
const ADMIN_LIKE_ROLES = ['admin', 'manager', 'scheduler', 'hr'];
const NOTIFY_BATCH_CHUNK_SIZE = 400;

// Compliance/fatigue thresholds — healthcare-typical defaults. Not yet
// configurable per org; a reasonable starting point rather than a precise
// regulatory citation for any specific state.
const ASSIGNED_STATUSES = new Set(['assigned', 'claimed', 'in_progress', 'completed']);
const COMPLIANCE_WINDOW_BACK_MS = 1 * 24 * 60 * 60 * 1000; // include yesterday, so a rest gap spanning midnight is still caught
const COMPLIANCE_WINDOW_FWD_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_REST_HOURS = 8;
const MAX_CONSECUTIVE_DAYS = 6;
const MAX_WEEKLY_HOURS = 60;

// Long-term understaffing forecast — reuses the aiDigests history that's
// already stored (one doc per day that had gaps/alerts). Only computed
// weekly, not daily, since it adds an extra Claude call per org.
const FORECAST_LOOKBACK_MS = 56 * 24 * 60 * 60 * 1000; // 8 weeks of digest history
const FORECAST_HALF_MS = 28 * 24 * 60 * 60 * 1000; // recent 4 weeks vs prior 4 weeks

interface GapItem {
  shiftId: string;
  title: string;
  locationName: string;
  status: string;
  requiredJobRole: string | null;
  startAtMs: number;
  needsPublish: boolean; // true if still draft/open — a publish proposal is staged for these
}

interface ComplianceAlert {
  type: 'overlap' | 'insufficient_rest' | 'excessive_consecutive' | 'weekly_hours';
  severity: 'warning' | 'critical';
  userId: string;
  userLabel: string;
  detail: string;
}

interface UnderstaffingForecast extends UnderstaffingTrend {
  commentary: string | null;
}

function toMs(value: unknown): number | null {
  if (!value) return null;
  const asAny = value as { toMillis?: () => number };
  if (typeof asAny.toMillis === 'function') return asAny.toMillis();
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function findCoverageGaps(db: FirebaseFirestore.Firestore, orgId: string, nowMs: number): Promise<GapItem[]> {
  const snap = await db
    .collection('orgs').doc(orgId).collection('shifts')
    .where('startAt', '>=', Timestamp.fromMillis(nowMs))
    .where('startAt', '<=', Timestamp.fromMillis(nowMs + LOOKAHEAD_MS))
    .orderBy('startAt', 'asc')
    .limit(200)
    .get();

  const gaps: GapItem[] = [];
  for (const doc of snap.docs) {
    const x = doc.data() as Record<string, unknown>;
    const status = String(x.status ?? '');
    if (!OPEN_STATUSES.has(status)) continue;
    if (x.assignedUserId) continue; // already covered
    const startAtMs = toMs(x.startAt);
    if (startAtMs == null) continue;
    gaps.push({
      shiftId: doc.id,
      title: String(x.title ?? 'Shift'),
      locationName: String(x.locationName ?? ''),
      status,
      requiredJobRole: (x.requiredJobRole as string) ?? null,
      startAtMs,
      needsPublish: status === 'draft' || status === 'open',
    });
  }
  return gaps;
}

async function findComplianceAlerts(db: FirebaseFirestore.Firestore, orgId: string, nowMs: number): Promise<ComplianceAlert[]> {
  const windowStart = nowMs - COMPLIANCE_WINDOW_BACK_MS;
  const windowEnd = nowMs + COMPLIANCE_WINDOW_FWD_MS;

  const snap = await db
    .collection('orgs').doc(orgId).collection('shifts')
    .where('startAt', '>=', Timestamp.fromMillis(windowStart))
    .where('startAt', '<=', Timestamp.fromMillis(windowEnd))
    .orderBy('startAt', 'asc')
    .limit(500)
    .get();

  type ShiftSlice = { shiftId: string; title: string; startAtMs: number; endAtMs: number };
  const byUser = new Map<string, ShiftSlice[]>();
  for (const doc of snap.docs) {
    const x = doc.data() as Record<string, unknown>;
    if (!ASSIGNED_STATUSES.has(String(x.status ?? ''))) continue;
    const uid = String(x.assignedUserId ?? '').trim();
    if (!uid) continue;
    const startAtMs = toMs(x.startAt);
    const endAtMs = toMs(x.endAt);
    if (startAtMs == null || endAtMs == null) continue;
    const list = byUser.get(uid) ?? [];
    list.push({ shiftId: doc.id, title: String(x.title ?? 'Shift'), startAtMs, endAtMs });
    byUser.set(uid, list);
  }
  if (byUser.size === 0) return [];

  // Resolve display names in one batch rather than per-alert.
  const usersSnap = await db.collection('orgs').doc(orgId).collection('users').limit(300).get();
  const labelByUid = new Map<string, string>();
  for (const doc of usersSnap.docs) {
    const x = doc.data() as Record<string, unknown>;
    labelByUid.set(doc.id, String(x.displayName || x.email || 'Staff member'));
  }

  const alerts: ComplianceAlert[] = [];
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

  for (const [uid, rawShifts] of byUser) {
    const shifts = [...rawShifts].sort((a, b) => a.startAtMs - b.startAtMs);
    const userLabel = labelByUid.get(uid) || 'Staff member';

    // Overlap / insufficient rest between consecutive shifts.
    for (let i = 1; i < shifts.length; i++) {
      const prev = shifts[i - 1];
      const curr = shifts[i];
      const gapHours = (curr.startAtMs - prev.endAtMs) / 3_600_000;
      if (gapHours < 0) {
        alerts.push({
          type: 'overlap', severity: 'critical', userId: uid, userLabel,
          detail: `${userLabel} is double-booked: "${prev.title}" overlaps "${curr.title}" around ${fmt(curr.startAtMs)}.`,
        });
      } else if (gapHours < MIN_REST_HOURS) {
        alerts.push({
          type: 'insufficient_rest', severity: 'warning', userId: uid, userLabel,
          detail: `${userLabel} has only ${gapHours.toFixed(1)}h of rest between "${prev.title}" (ends ${fmt(prev.endAtMs)}) and "${curr.title}" (starts ${fmt(curr.startAtMs)}).`,
        });
      }
    }

    // Consecutive calendar days worked (UTC-date granularity — org-local
    // timezone isn't tracked on the org record today).
    const dateKeys = Array.from(new Set(shifts.map((s) => new Date(s.startAtMs).toISOString().slice(0, 10)))).sort();
    let streak = 1;
    let maxStreak = 1;
    for (let i = 1; i < dateKeys.length; i++) {
      const prevDate = new Date(dateKeys[i - 1] + 'T00:00:00Z').getTime();
      const currDate = new Date(dateKeys[i] + 'T00:00:00Z').getTime();
      streak = currDate - prevDate === 86_400_000 ? streak + 1 : 1;
      maxStreak = Math.max(maxStreak, streak);
    }
    if (maxStreak > MAX_CONSECUTIVE_DAYS) {
      alerts.push({
        type: 'excessive_consecutive', severity: 'warning', userId: uid, userLabel,
        detail: `${userLabel} is scheduled for ${maxStreak} consecutive days.`,
      });
    }

    // Total scheduled hours across the ~8-day window.
    const totalHours = shifts.reduce((sum, s) => sum + (s.endAtMs - s.startAtMs) / 3_600_000, 0);
    if (totalHours > MAX_WEEKLY_HOURS) {
      alerts.push({
        type: 'weekly_hours', severity: 'warning', userId: uid, userLabel,
        detail: `${userLabel} is scheduled for ${totalHours.toFixed(1)} hours this week.`,
      });
    }
  }

  return alerts;
}

async function summarize(client: OpenAI, orgName: string, gaps: GapItem[], alerts: ComplianceAlert[]): Promise<string> {
  const lines = gaps.map((g) => {
    const when = new Date(g.startAtMs).toISOString();
    return `- "${g.title}" at ${g.locationName || 'unspecified location'} (${g.requiredJobRole || 'any role'}), starts ${when}, status=${g.status}`;
  });
  const alertLines = alerts.map((a) => `- [${a.severity}] ${a.detail}`);
  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 250,
      messages: [
        { role: 'system', content: 'You write short, plain-English morning briefings for a healthcare scheduling admin. 2-3 sentences max. No greeting, no sign-off, just the facts and what needs attention.' },
        {
          role: 'user',
          content: `Organization: ${orgName}. Unfilled shifts in the next 3 days:\n${lines.join('\n') || '(none)'}\n\nStaffing compliance alerts (rest periods, consecutive days, weekly hours):\n${alertLines.join('\n') || '(none)'}\n\nWrite the briefing.`,
        },
      ],
    });
    const text = (resp.choices[0]?.message?.content || '').trim();
    return text || fallbackSummary(gaps.length, alerts.length);
  } catch (e) {
    logger.warn('[dailyDigest] OpenAI summary failed, falling back to a templated one', e);
    return fallbackSummary(gaps.length, alerts.length);
  }
}

function fallbackSummary(gapCount: number, alertCount: number): string {
  const parts: string[] = [];
  if (gapCount > 0) parts.push(`${gapCount} shift(s) in the next 3 days still need coverage`);
  if (alertCount > 0) parts.push(`${alertCount} staffing compliance alert(s) to review`);
  return parts.join('; ') + '.';
}

function isForecastDay(nowMs: number): boolean {
  return new Date(nowMs).getUTCDay() === 1; // Monday — keeps the extra LLM call weekly, not daily
}

/**
 * Trend over the last 8 weeks of digest history, split into a recent and a
 * prior 4-week half. aiDigests only has a doc for days that actually had
 * gaps/alerts (see generateDigestForOrg's early return), so this measures
 * both how often problem-days occur and how bad they are on those days —
 * not a full daily time series. See deriveUnderstaffingTrend for the
 * direction math.
 */
async function computeUnderstaffingTrend(db: FirebaseFirestore.Firestore, orgId: string, nowMs: number): Promise<UnderstaffingTrend | null> {
  const since = nowMs - FORECAST_LOOKBACK_MS;
  const splitAt = nowMs - FORECAST_HALF_MS;

  const snap = await db
    .collection('orgs').doc(orgId).collection('aiDigests')
    .where('generatedAt', '>=', Timestamp.fromMillis(since))
    .orderBy('generatedAt', 'asc')
    .limit(56)
    .get();

  const recent: number[] = [];
  const prior: number[] = [];
  for (const doc of snap.docs) {
    const x = doc.data() as Record<string, unknown>;
    const ts = toMs(x.generatedAt);
    if (ts == null) continue;
    const gapCount = Array.isArray(x.gaps) ? x.gaps.length : 0;
    (ts >= splitAt ? recent : prior).push(gapCount);
  }

  return deriveUnderstaffingTrend(recent, prior);
}

async function forecastCommentary(client: OpenAI, orgName: string, trend: UnderstaffingTrend): Promise<string | null> {
  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 120,
      messages: [
        { role: 'system', content: 'You write a single forward-looking sentence (max 30 words) about a healthcare org\'s longer-term staffing risk trend, based on problem-day counts over the last 4 weeks vs the prior 4 weeks. No greeting, no hedging filler — one direct sentence.' },
        {
          role: 'user',
          content: `Organization: ${orgName}. Last 4 weeks: ${trend.recentProblemDays} day(s) with coverage/compliance issues (avg ${trend.recentAvgGaps.toFixed(1)} unfilled shifts on those days). Prior 4 weeks: ${trend.priorProblemDays} day(s) (avg ${trend.priorAvgGaps.toFixed(1)}). Overall trend: ${trend.direction}. Write the one-sentence outlook.`,
        },
      ],
    });
    const text = (resp.choices[0]?.message?.content || '').trim();
    return text || null;
  } catch (e) {
    logger.warn('[dailyDigest] forecast commentary failed, digest will show the trend without commentary', e);
    return null;
  }
}

async function resolveAdminUids(db: FirebaseFirestore.Firestore, orgId: string): Promise<string[]> {
  const usersSnap = await db.collection('orgs').doc(orgId).collection('users').get();
  const adminUids: string[] = [];
  for (const doc of usersSnap.docs) {
    const x = doc.data() as Record<string, unknown>;
    if (x.active === false) continue;
    if (ADMIN_LIKE_ROLES.includes(String(x.accessRole || ''))) adminUids.push(doc.id);
  }
  return adminUids;
}

async function commitInChunks(db: FirebaseFirestore.Firestore, writes: Array<(batch: FirebaseFirestore.WriteBatch) => void>) {
  for (let i = 0; i < writes.length; i += NOTIFY_BATCH_CHUNK_SIZE) {
    const batch = db.batch();
    for (const apply of writes.slice(i, i + NOTIFY_BATCH_CHUNK_SIZE)) apply(batch);
    await batch.commit();
  }
}

/**
 * Notifies admin-like staff that a new digest is ready — in-app inbox item
 * plus a best-effort push, mirroring the pattern in shift-reopen-notify.ts.
 * Only called when a digest was actually generated (gaps or alerts exist).
 */
async function notifyAdminsOfDigest(db: FirebaseFirestore.Firestore, orgId: string, summary: string, dateKey: string, nowMs: number): Promise<void> {
  const adminUids = await resolveAdminUids(db, orgId);
  if (!adminUids.length) return;

  const now = Timestamp.fromMillis(nowMs);
  const writes: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  for (const uid of adminUids) {
    const itemRef = db.collection('orgs').doc(orgId).collection('userNotifications').doc(uid).collection('items').doc();
    writes.push((batch) => batch.set(itemRef, {
      orgId,
      uid,
      type: 'ai_digest',
      title: 'Daily staffing digest',
      body: summary,
      read: false,
      createdAt: now,
      updatedAt: now,
      createdBy: 'system',
      meta: { dateKey },
    }));
  }
  await commitInChunks(db, writes);

  await sendPushToUids(orgId, adminUids, {
    title: 'Daily staffing digest',
    body: summary,
    data: { type: 'ai_digest', orgId, dateKey, deepLink: '/admin/ai-copilot' },
    link: '/admin/ai-copilot',
  });
}

async function generateDigestForOrg(db: FirebaseFirestore.Firestore, orgId: string, orgName: string, client: OpenAI | null, nowMs: number) {
  const [gaps, alerts] = await Promise.all([
    findCoverageGaps(db, orgId, nowMs),
    findComplianceAlerts(db, orgId, nowMs),
  ]);
  if (gaps.length === 0 && alerts.length === 0) return; // nothing to report — skip writing a doc and skip the API call entirely

  const proposals: Proposal[] = gaps
    .filter((g) => g.needsPublish)
    .map((g) => buildProposal('propose_publish_shift', { shiftId: g.shiftId, shiftLabel: `${g.title} — ${g.locationName}` }));

  const summary = client
    ? await summarize(client, orgName, gaps, alerts)
    : fallbackSummary(gaps.length, alerts.length);

  let forecast: UnderstaffingForecast | null = null;
  if (isForecastDay(nowMs)) {
    const trend = await computeUnderstaffingTrend(db, orgId, nowMs);
    if (trend) {
      const commentary = client ? await forecastCommentary(client, orgName, trend) : null;
      forecast = { ...trend, commentary };
    }
  }

  const dateKey = new Date(nowMs).toISOString().slice(0, 10);
  await db
    .collection('orgs').doc(orgId).collection('aiDigests').doc(dateKey)
    .set({
      orgId,
      dateKey,
      generatedAt: Timestamp.fromMillis(nowMs),
      summary,
      gaps,
      alerts,
      proposals,
      forecast,
    });

  await notifyAdminsOfDigest(db, orgId, summary, dateKey, nowMs);
}

export const dailyDigest = onSchedule(
  { schedule: 'every day 08:00', timeZone: 'America/New_York', secrets: [openaiApiKey], timeoutSeconds: 300 },
  async () => {
    const admin = initFirebase();
    const db = admin.firestore();
    const nowMs = Date.now();

    const apiKey = openaiApiKey.value();
    const client = apiKey ? new OpenAI({ apiKey }) : null;
    if (!client) {
      logger.warn('[dailyDigest] OPENAI_API_KEY not set — digests will use a templated summary instead of an AI-written one.');
    }

    const orgsSnap = await db.collection('orgs').where('planStatus', 'in', ['active', 'trialing']).get();
    logger.info(`[dailyDigest] scanning ${orgsSnap.size} active org(s)`);

    for (const orgDoc of orgsSnap.docs) {
      try {
        const orgName = String((orgDoc.data() as any)?.name || orgDoc.id);
        await generateDigestForOrg(db, orgDoc.id, orgName, client, nowMs);
      } catch (e) {
        logger.error(`[dailyDigest] failed for org ${orgDoc.id}`, e);
      }
    }
  }
);
