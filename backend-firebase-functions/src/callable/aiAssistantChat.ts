import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import Anthropic from '@anthropic-ai/sdk';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { Proposal, buildProposal } from '../domain/ai-proposals';

export const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

const MODEL = 'claude-sonnet-5';
const MAX_TOOL_ITERATIONS = 5;
const MAX_HISTORY_TURNS = 20;

// ----------------------------------------------------------------------
// Tool schemas. Two kinds:
//  - Read tools (get_*) are executed server-side against Firestore and
//    fed back to the model so it can reason over real org data.
//  - Proposal tools (propose_*) never touch Firestore. They are collected
//    into a `proposals` array returned to the client, which renders a
//    confirm/dismiss card and — only on explicit admin confirmation —
//    calls the SAME already-audited callables (createShift, assignShift,
//    publishShift, unassignShift) the rest of the app already uses. The
//    assistant itself has no write path into the database.
// ----------------------------------------------------------------------
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_shifts',
    description: 'List shifts for this organization within an optional date range and status. Use this to answer questions about coverage, open shifts, or who is scheduled.',
    input_schema: {
      type: 'object',
      properties: {
        startAtMs: { type: 'number', description: 'Only shifts starting on/after this epoch ms. Optional.' },
        endAtMs: { type: 'number', description: 'Only shifts starting on/before this epoch ms. Optional.' },
        status: {
          type: 'string',
          enum: ['open', 'published', 'assigned', 'claimed', 'in_progress', 'completed', 'expired', 'cancelled', 'no_show'],
          description: 'Filter by shift status. Optional.',
        },
        limit: { type: 'number', description: 'Max results, default 30, max 50.' },
      },
    },
  },
  {
    name: 'get_org_users',
    description: 'List staff members in this organization, optionally filtered by job role. Use this to find candidates to assign to a shift.',
    input_schema: {
      type: 'object',
      properties: {
        jobRole: { type: 'string', description: 'Filter by job role (e.g. "RN", "CNA"). Optional.' },
        limit: { type: 'number', description: 'Max results, default 30, max 100.' },
      },
    },
  },
  {
    name: 'propose_create_shift',
    description: 'Propose creating a new shift. This does NOT create it — it is shown to the admin for one-click confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        locationName: { type: 'string' },
        startAtMs: { type: 'number', description: 'Epoch ms.' },
        endAtMs: { type: 'number', description: 'Epoch ms.' },
        requiredJobRole: { type: 'string' },
        payRate: { type: 'number' },
        notes: { type: 'string' },
      },
      required: ['title', 'locationName', 'startAtMs', 'endAtMs'],
    },
  },
  {
    name: 'propose_assign_shift',
    description: 'Propose assigning a staff member to an existing shift. This does NOT assign it — it is shown to the admin for one-click confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        shiftId: { type: 'string' },
        shiftLabel: { type: 'string', description: 'Human-readable label for the shift, e.g. "Standard Shift — Tue Jul 14, 8:00 AM".' },
        assigneeUid: { type: 'string' },
        assigneeLabel: { type: 'string', description: 'Human-readable name of the staff member.' },
      },
      required: ['shiftId', 'assigneeUid'],
    },
  },
  {
    name: 'propose_publish_shift',
    description: 'Propose publishing an open/draft shift to the marketplace so staff can see and claim it. This does NOT publish it — it is shown to the admin for one-click confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        shiftId: { type: 'string' },
        shiftLabel: { type: 'string' },
      },
      required: ['shiftId'],
    },
  },
  {
    name: 'propose_unassign_shift',
    description: 'Propose removing the currently assigned staff member from a shift. This does NOT unassign it — it is shown to the admin for one-click confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        shiftId: { type: 'string' },
        shiftLabel: { type: 'string' },
      },
      required: ['shiftId'],
    },
  },
];

const PROPOSAL_TOOL_NAMES = new Set([
  'propose_create_shift',
  'propose_assign_shift',
  'propose_publish_shift',
  'propose_unassign_shift',
]);

function toMs(value: unknown): number | null {
  if (!value) return null;
  const asAny = value as { toMillis?: () => number };
  if (typeof asAny.toMillis === 'function') return asAny.toMillis();
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function runGetShifts(db: FirebaseFirestore.Firestore, orgId: string, input: any) {
  let q: FirebaseFirestore.Query = db.collection('orgs').doc(orgId).collection('shifts');
  if (input?.status) q = q.where('status', '==', String(input.status));
  if (input?.startAtMs) q = q.where('startAt', '>=', Timestamp.fromMillis(Number(input.startAtMs)));
  if (input?.endAtMs) q = q.where('startAt', '<=', Timestamp.fromMillis(Number(input.endAtMs)));
  const limit = Math.max(1, Math.min(50, Number(input?.limit) || 30));
  q = q.orderBy('startAt', 'asc').limit(limit);
  const snap = await q.get();
  return snap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    return {
      shiftId: d.id,
      title: x.title ?? null,
      locationName: x.locationName ?? null,
      status: x.status ?? null,
      requiredJobRole: x.requiredJobRole ?? null,
      assignedUserId: x.assignedUserId ?? null,
      startAtMs: toMs(x.startAt),
      endAtMs: toMs(x.endAt),
    };
  });
}

async function runGetOrgUsers(db: FirebaseFirestore.Firestore, orgId: string, input: any) {
  // Fetch a generous batch and filter in-memory rather than a Firestore
  // `!=` query on `active` — `!=` silently excludes docs where the field
  // was never set, which would hide legitimate active staff whose record
  // predates that field (same class of bug fixed in storage.rules).
  const snap = await db.collection('orgs').doc(orgId).collection('users').limit(300).get();
  const limit = Math.max(1, Math.min(100, Number(input?.limit) || 30));
  let items = snap.docs
    .filter((d) => (d.data() as Record<string, unknown>).active !== false)
    .map((d) => {
      const x = d.data() as Record<string, unknown>;
      return {
        uid: d.id,
        displayName: x.displayName ?? null,
        email: x.email ?? null,
        jobRole: x.jobRole ?? null,
        accessRole: x.accessRole ?? null,
      };
    });
  if (input?.jobRole) {
    const wanted = String(input.jobRole).trim().toLowerCase();
    items = items.filter((u) => String(u.jobRole || '').trim().toLowerCase() === wanted);
  }
  return items.slice(0, limit);
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export const aiAssistantChat = onCall({ secrets: [anthropicApiKey] }, async (req) => {
  const ctx = await resolveTenantWithFallback(req);
  if (!ctx.isAdminLike) {
    throw new HttpsError('permission-denied', 'Admin-level privileges required.');
  }

  const message = String(req.data?.message || '').trim();
  if (!message) throw new HttpsError('invalid-argument', 'message is required.');
  if (message.length > 4000) throw new HttpsError('invalid-argument', 'message must be 4000 characters or less.');

  const historyRaw: unknown = req.data?.history;
  const history: ChatTurn[] = Array.isArray(historyRaw)
    ? historyRaw
        .filter((t: any) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
        .slice(-MAX_HISTORY_TURNS)
        .map((t: any) => ({ role: t.role, text: String(t.text).slice(0, 4000) }))
    : [];

  const admin = initFirebase();
  const db = admin.firestore();
  const orgId = ctx.orgId;

  const todayIso = new Date().toISOString().slice(0, 10);
  const systemPrompt = [
    'You are the InnovaShift AI Copilot, an assistant embedded in a healthcare workforce scheduling app.',
    `You are helping an admin/manager (role: ${ctx.role ?? 'admin'}) manage organization ${orgId}.`,
    `Today's date is ${todayIso}.`,
    'Use the get_shifts and get_org_users tools to look up real data before answering — never guess or invent shift IDs, names, or counts.',
    'When the admin asks you to create, assign, publish, or unassign a shift, use the matching propose_* tool. These tools do NOT execute anything — they only stage a proposal that the admin must explicitly confirm in the UI. Always tell the user the action is pending their confirmation, never say it is done.',
    'Be concise. Prefer short, direct answers over long explanations.',
  ].join('\n');

  const messages: Anthropic.MessageParam[] = [];
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.text });
  }
  messages.push({ role: 'user', content: message });

  const client = new Anthropic({ apiKey: anthropicApiKey.value() });
  const proposals: Proposal[] = [];
  let replyText = '';

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      });
    } catch (e: any) {
      logger.error('[aiAssistantChat] Anthropic API error', e);
      throw new HttpsError('internal', 'AI assistant is temporarily unavailable. Please try again.');
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    if (textBlocks.length) replyText = textBlocks.map((b) => b.text).join('\n').trim();

    if (toolUses.length === 0) {
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      try {
        if (PROPOSAL_TOOL_NAMES.has(tu.name)) {
          const proposal = buildProposal(tu.name, tu.input);
          proposals.push(proposal);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: 'Proposal staged and shown to the admin for confirmation. It has not been executed yet.',
          });
        } else if (tu.name === 'get_shifts') {
          const items = await runGetShifts(db, orgId, tu.input);
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(items) });
        } else if (tu.name === 'get_org_users') {
          const items = await runGetOrgUsers(db, orgId, tu.input);
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(items) });
        } else {
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Unknown tool.', is_error: true });
        }
      } catch (e: any) {
        logger.error(`[aiAssistantChat] tool ${tu.name} failed`, e);
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Tool execution failed.', is_error: true });
      }
    }
    messages.push({ role: 'user', content: toolResults });

    // If this turn only produced proposals (no reads), there's nothing further
    // for the model to reason over — stop rather than spending another round trip.
    if (toolUses.every((tu) => PROPOSAL_TOOL_NAMES.has(tu.name))) {
      break;
    }
  }

  return {
    ok: true,
    reply: replyText || 'Done.',
    proposals,
  };
});
