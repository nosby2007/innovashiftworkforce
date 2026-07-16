import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import Anthropic from '@anthropic-ai/sdk';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { Proposal, buildProposal } from '../domain/ai-proposals';

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

const MODEL = 'claude-sonnet-5';
const LOOKAHEAD_MS = 3 * 24 * 60 * 60 * 1000; // shifts starting in the next 3 days
const OPEN_STATUSES = new Set(['draft', 'open', 'published']);

interface GapItem {
  shiftId: string;
  title: string;
  locationName: string;
  status: string;
  requiredJobRole: string | null;
  startAtMs: number;
  needsPublish: boolean; // true if still draft/open — a publish proposal is staged for these
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

async function summarize(client: Anthropic, orgName: string, gaps: GapItem[]): Promise<string> {
  const lines = gaps.map((g) => {
    const when = new Date(g.startAtMs).toISOString();
    return `- "${g.title}" at ${g.locationName || 'unspecified location'} (${g.requiredJobRole || 'any role'}), starts ${when}, status=${g.status}`;
  });
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 250,
      system: 'You write short, plain-English morning briefings for a healthcare scheduling admin. 2-3 sentences max. No greeting, no sign-off, just the facts and what needs attention.',
      messages: [{
        role: 'user',
        content: `Organization: ${orgName}. Unfilled shifts in the next 3 days:\n${lines.join('\n')}\n\nWrite the briefing.`,
      }],
    });
    const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(' ').trim();
    return text || `${gaps.length} shift(s) in the next 3 days still need coverage.`;
  } catch (e) {
    logger.warn('[dailyDigest] Anthropic summary failed, falling back to a templated one', e);
    return `${gaps.length} shift(s) in the next 3 days still need coverage.`;
  }
}

async function generateDigestForOrg(db: FirebaseFirestore.Firestore, orgId: string, orgName: string, client: Anthropic | null, nowMs: number) {
  const gaps = await findCoverageGaps(db, orgId, nowMs);
  if (gaps.length === 0) return; // nothing to report — skip writing a doc and skip the API call entirely

  const proposals: Proposal[] = gaps
    .filter((g) => g.needsPublish)
    .map((g) => buildProposal('propose_publish_shift', { shiftId: g.shiftId, shiftLabel: `${g.title} — ${g.locationName}` }));

  const summary = client
    ? await summarize(client, orgName, gaps)
    : `${gaps.length} shift(s) in the next 3 days still need coverage.`;

  const dateKey = new Date(nowMs).toISOString().slice(0, 10);
  await db
    .collection('orgs').doc(orgId).collection('aiDigests').doc(dateKey)
    .set({
      orgId,
      dateKey,
      generatedAt: Timestamp.fromMillis(nowMs),
      summary,
      gaps,
      proposals,
    });
}

export const dailyDigest = onSchedule(
  { schedule: 'every day 08:00', timeZone: 'America/New_York', secrets: [anthropicApiKey], timeoutSeconds: 300 },
  async () => {
    const admin = initFirebase();
    const db = admin.firestore();
    const nowMs = Date.now();

    const apiKey = anthropicApiKey.value();
    const client = apiKey ? new Anthropic({ apiKey }) : null;
    if (!client) {
      logger.warn('[dailyDigest] ANTHROPIC_API_KEY not set — digests will use a templated summary instead of an AI-written one.');
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
