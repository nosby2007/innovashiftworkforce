import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import OpenAI from 'openai';
import { Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';
import { Proposal, buildProposal } from '../domain/ai-proposals';
import { entryHours, grossPay, estimatedDeductions, estimatedNet } from '../domain/payroll-math';

export const openaiApiKey = defineSecret('OPENAI_API_KEY');

// The ChatGPT app's model picker shows friendly names ("GPT-5.6 Sol") that
// don't always match the exact API model id — verify this against the
// model list on platform.openai.com if calls start failing with a
// "model not found" error, and update just this one constant.
const MODEL = 'gpt-5.6';
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
const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_shifts',
      description: 'List shifts for this organization within an optional date range and status. Use this to answer questions about coverage, open shifts, or who is scheduled.',
      parameters: {
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
  },
  {
    type: 'function',
    function: {
      name: 'get_org_users',
      description: 'List staff members in this organization, optionally filtered by job role. Use this to find candidates to assign to a shift.',
      parameters: {
        type: 'object',
        properties: {
          jobRole: { type: 'string', description: 'Filter by job role (e.g. "RN", "CNA"). Optional.' },
          limit: { type: 'number', description: 'Max results, default 30, max 100.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_timesheet_summary',
      description: 'Summarize hours worked and estimated payroll cost for a date range, overall or for one staff member. Use this to answer questions about hours worked, labor cost, or which staff worked the most. Figures are the same flat-rate estimate (no tax tables) shown on the Payroll page, not a precise payroll run.',
      parameters: {
        type: 'object',
        properties: {
          startAtMs: { type: 'number', description: 'Start of the period, epoch ms.' },
          endAtMs: { type: 'number', description: 'End of the period, epoch ms.' },
          userId: { type: 'string', description: 'Optional — scope to one staff member (get the uid from get_org_users first). Omit for an org-wide summary.' },
        },
        required: ['startAtMs', 'endAtMs'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_create_shift',
      description: 'Propose creating a new shift. This does NOT create it — it is shown to the admin for one-click confirmation.',
      parameters: {
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
  },
  {
    type: 'function',
    function: {
      name: 'propose_assign_shift',
      description: 'Propose assigning a staff member to an existing shift. This does NOT assign it — it is shown to the admin for one-click confirmation.',
      parameters: {
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
  },
  {
    type: 'function',
    function: {
      name: 'propose_publish_shift',
      description: 'Propose publishing an open/draft shift to the marketplace so staff can see and claim it. This does NOT publish it — it is shown to the admin for one-click confirmation.',
      parameters: {
        type: 'object',
        properties: {
          shiftId: { type: 'string' },
          shiftLabel: { type: 'string' },
        },
        required: ['shiftId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_unassign_shift',
      description: 'Propose removing the currently assigned staff member from a shift. This does NOT unassign it — it is shown to the admin for one-click confirmation.',
      parameters: {
        type: 'object',
        properties: {
          shiftId: { type: 'string' },
          shiftLabel: { type: 'string' },
        },
        required: ['shiftId'],
      },
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

async function runGetTimesheetSummary(db: FirebaseFirestore.Firestore, orgId: string, input: any) {
  const startAtMs = Number(input?.startAtMs);
  const endAtMs = Number(input?.endAtMs);
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs) || endAtMs < startAtMs) {
    return { error: 'startAtMs and endAtMs are required and endAtMs must be >= startAtMs.' };
  }

  let q: FirebaseFirestore.Query = db
    .collection('orgs').doc(orgId).collection('timeEntries')
    .where('checkInAt', '>=', Timestamp.fromMillis(startAtMs))
    .where('checkInAt', '<=', Timestamp.fromMillis(endAtMs));
  if (input?.userId) q = q.where('userId', '==', String(input.userId));

  const snap = await q.orderBy('checkInAt', 'asc').limit(1000).get();
  if (snap.empty) {
    return { periodStart: startAtMs, periodEnd: endAtMs, totalHours: 0, totalGrossEstimate: 0, entryCount: 0, byUser: [] };
  }

  const shiftIds = Array.from(new Set(snap.docs.map((d) => String((d.data() as any).shiftId || '')).filter(Boolean)));
  const rateByShiftId = new Map<string, number>();
  await Promise.all(shiftIds.map(async (shiftId) => {
    const shiftSnap = await db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId).get();
    rateByShiftId.set(shiftId, Number((shiftSnap.data() as any)?.payRate) || 0);
  }));

  const usersSnap = await db.collection('orgs').doc(orgId).collection('users').limit(300).get();
  const labelByUid = new Map<string, string>();
  for (const doc of usersSnap.docs) {
    const x = doc.data() as Record<string, unknown>;
    labelByUid.set(doc.id, String(x.displayName || x.email || 'Staff member'));
  }

  const byUser = new Map<string, { userId: string; userLabel: string; hours: number; grossEstimate: number; entryCount: number; openEntryCount: number }>();
  for (const doc of snap.docs) {
    const x = doc.data() as Record<string, unknown>;
    const userId = String(x.userId || '');
    if (!userId) continue;
    const checkInMs = toMs(x.checkInAt) ?? 0;
    const checkOutMs = toMs(x.checkOutAt);
    const bucket = byUser.get(userId) ?? { userId, userLabel: labelByUid.get(userId) || 'Staff member', hours: 0, grossEstimate: 0, entryCount: 0, openEntryCount: 0 };
    bucket.entryCount += 1;
    if (checkOutMs == null) {
      bucket.openEntryCount += 1;
    } else {
      const hours = entryHours(checkInMs, checkOutMs, Number(x.totalBreakMs) || 0);
      const rate = rateByShiftId.get(String(x.shiftId || '')) || 0;
      bucket.hours += hours;
      bucket.grossEstimate += grossPay(hours, rate);
    }
    byUser.set(userId, bucket);
  }

  const users = Array.from(byUser.values())
    .map((u) => ({
      ...u,
      hours: Math.round(u.hours * 100) / 100,
      grossEstimate: Math.round(u.grossEstimate * 100) / 100,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 50);

  const totalHours = Math.round(users.reduce((sum, u) => sum + u.hours, 0) * 100) / 100;
  const totalGrossEstimate = Math.round(users.reduce((sum, u) => sum + u.grossEstimate, 0) * 100) / 100;

  return {
    periodStart: startAtMs,
    periodEnd: endAtMs,
    totalHours,
    totalGrossEstimate,
    totalDeductionsEstimate: estimatedDeductions(totalGrossEstimate),
    totalNetEstimate: estimatedNet(totalGrossEstimate),
    entryCount: snap.size,
    byUser: users,
  };
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export const aiAssistantChat = onCall({ secrets: [openaiApiKey] }, async (req) => {
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
    'Use the get_shifts, get_org_users, and get_timesheet_summary tools to look up real data before answering — never guess or invent shift IDs, names, counts, hours, or dollar amounts.',
    'get_timesheet_summary figures (gross/deductions/net) are the same flat-rate estimate shown on the Payroll page — a rough placeholder, not a real tax/withholding calculation. When you report a dollar figure from it, call it an estimate.',
    'When the admin asks you to create, assign, publish, or unassign a shift, use the matching propose_* tool. These tools do NOT execute anything — they only stage a proposal that the admin must explicitly confirm in the UI. Always tell the user the action is pending their confirmation, never say it is done.',
    'Be concise. Prefer short, direct answers over long explanations.',
  ].join('\n');

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.text });
  }
  messages.push({ role: 'user', content: message });

  const client = new OpenAI({ apiKey: openaiApiKey.value() });
  const proposals: Proposal[] = [];
  let replyText = '';

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    let response: OpenAI.Chat.ChatCompletion;
    try {
      response = await client.chat.completions.create({
  model: MODEL,
  reasoning_effort: 'none',
  max_completion_tokens: 1024,
  tools: TOOLS,
  messages,
});
    } catch (e: any) {
      logger.error('[aiAssistantChat] OpenAI API error', e);
      // Surface the OpenAI error status/code (not the key or full stack) so a
      // failure is diagnosable from the browser console without needing
      // Firebase Console log access — e.g. "(404 model_not_found)" points
      // straight at a bad MODEL value, "(401 invalid_api_key)" at the secret.
      const status = e?.status ?? e?.response?.status;
      const code = e?.code || e?.error?.code || e?.type;
      const hint = status || code ? ` (${[status, code].filter(Boolean).join(' ')})` : '';
      throw new HttpsError('internal', `AI assistant is temporarily unavailable${hint}. Please try again.`);
    }

    const assistantMessage = response.choices[0]?.message;
    if (!assistantMessage) break;
    messages.push({
      role: 'assistant',
      content: assistantMessage.content,
      tool_calls: assistantMessage.tool_calls,
    });

    if (assistantMessage.content) replyText = assistantMessage.content.trim();

    const toolCalls = (assistantMessage.tool_calls || []).filter(
      (tc): tc is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => tc.type === 'function'
    );
    if (toolCalls.length === 0) {
      break;
    }

    for (const tc of toolCalls) {
      let input: any = {};
      try {
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        input = {};
      }
      try {
        if (PROPOSAL_TOOL_NAMES.has(tc.function.name)) {
          const proposal = buildProposal(tc.function.name, input);
          proposals.push(proposal);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: 'Proposal staged and shown to the admin for confirmation. It has not been executed yet.',
          });
        } else if (tc.function.name === 'get_shifts') {
          const items = await runGetShifts(db, orgId, input);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(items) });
        } else if (tc.function.name === 'get_org_users') {
          const items = await runGetOrgUsers(db, orgId, input);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(items) });
        } else if (tc.function.name === 'get_timesheet_summary') {
          const summary = await runGetTimesheetSummary(db, orgId, input);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(summary) });
        } else {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Unknown tool.' });
        }
      } catch (e: any) {
        logger.error(`[aiAssistantChat] tool ${tc.function.name} failed`, e);
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Tool execution failed.' });
      }
    }

    // If this turn only produced proposals (no reads), there's nothing further
    // for the model to reason over — stop rather than spending another round trip.
    if (toolCalls.every((tc) => PROPOSAL_TOOL_NAMES.has(tc.function.name))) {
      break;
    }
  }

  return {
    ok: true,
    reply: replyText || 'Done.',
    proposals,
  };
});
