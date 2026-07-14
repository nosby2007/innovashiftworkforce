import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Query, Timestamp } from 'firebase-admin/firestore';
import { initFirebase } from '../infra/firebase';
import { resolveTenantWithFallback } from '../infra/tenancy';

type ShiftStatus = 'open' | 'published' | 'assigned' | 'claimed' | 'in_progress' | 'completed' | 'expired' | 'cancelled' | 'no_show';

const ALLOWED_STATUSES: ShiftStatus[] = ['open', 'published', 'assigned', 'claimed', 'in_progress', 'completed', 'expired', 'cancelled', 'no_show'];

function parseOptionalMs(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseLimit(value: unknown): number {
  const n = Number(value ?? 50);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function normalizeStatus(value: unknown): ShiftStatus | null {
  const s = String(value ?? '').trim() as ShiftStatus;
  return ALLOWED_STATUSES.includes(s) ? s : null;
}

function normalizeString(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s.length > 0 ? s : null;
}

function toMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toMillis();
  const asAny = value as { toMillis?: () => number };
  if (typeof asAny.toMillis === 'function') return asAny.toMillis();
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const listShifts = onCall(async (req) => {
  const ctx = await resolveTenantWithFallback(req);
  const { uid, orgId, isAdminLike } = ctx;

  const admin = initFirebase();
  const db = admin.firestore();

  // --- Input parsing ---
  const assignedToMe = Boolean(req.data?.assignedToMe);

  const startAtMs = parseOptionalMs(req.data?.startAtMs);
  const endAtMs   = parseOptionalMs(req.data?.endAtMs);
  if (startAtMs != null && endAtMs != null && endAtMs < startAtMs) {
    throw new HttpsError('invalid-argument', 'endAtMs must be >= startAtMs.');
  }

  const status = normalizeStatus(req.data?.status);
  if (req.data?.status != null && String(req.data.status).trim() !== '' && !status) {
    throw new HttpsError('invalid-argument', 'Unsupported status value.');
  }

  const requiredJobRole = normalizeString(req.data?.requiredJobRole);

  // Cursor-based pagination: afterDocId is the last doc ID from the previous page
  const afterDocId = normalizeString(req.data?.afterDocId);

  const limit = parseLimit(req.data?.limit);

  // --- Query construction ---
  let q: Query = db.collection('orgs').doc(orgId).collection('shifts');

  // Staff can only see their own shifts unless explicitly allowed via role
  if (!isAdminLike || assignedToMe) {
    q = q.where('assignedUserId', '==', uid);
  }

  if (status) {
    q = q.where('status', '==', status);
  }

  if (requiredJobRole) {
    q = q.where('requiredJobRole', '==', requiredJobRole);
  }

  if (startAtMs != null) {
    q = q.where('startAt', '>=', Timestamp.fromMillis(startAtMs));
  }

  if (endAtMs != null) {
    q = q.where('startAt', '<=', Timestamp.fromMillis(endAtMs));
  }

  q = q.orderBy('startAt', 'asc');

  // Apply cursor if provided (fetch 1 extra to build next cursor)
  if (afterDocId) {
    const cursorSnap = await db
      .collection('orgs').doc(orgId).collection('shifts')
      .doc(afterDocId).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap);
    }
  }

  q = q.limit(limit + 1); // fetch one extra to detect next page

  const snap = await q.get();
  const hasMore = snap.docs.length > limit;
  const docs = hasMore ? snap.docs.slice(0, limit) : snap.docs;

  const items = docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      orgId,
      title: String(x.title ?? ''),
      locationName: String(x.locationName ?? ''),
      status: String(x.status ?? 'open'),
      requiredJobRole: x.requiredJobRole ?? null,
      assignedUserId: x.assignedUserId ?? null,
      payRate: x.payRate ?? null,
      notes: x.notes ?? null,
      startAtMs: toMs(x.startAt),
      endAtMs: toMs(x.endAt),
      updatedAtMs: toMs(x.updatedAt),
    };
  });

  return {
    ok: true,
    items,
    nextCursor: hasMore ? docs[docs.length - 1].id : null,
    hasMore,
  };
});