import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

function parseArgs(argv) {
  const out = {
    orgId: '',
    dryRun: false,
    maxEntries: 3000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--org') out.orgId = String(argv[i + 1] || '').trim();
    if (arg === '--dry-run') out.dryRun = true;
    if (arg === '--max') out.maxEntries = Math.max(1, Number(argv[i + 1] || 3000));
  }
  return out;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number(value) || 0;
}

function iso(value) {
  const ms = toMillis(value);
  return ms > 0 ? new Date(ms).toISOString() : 'n/a';
}

initializeApp({
  credential: applicationDefault(),
  projectId: 'atlanta-e04aa',
});
const db = getFirestore();

async function loadOrgIds(orgId) {
  if (orgId) return [orgId];
  const snap = await db.collection('orgs').get();
  return snap.docs.map((doc) => doc.id);
}

async function repairOrg(orgId, dryRun, maxEntries) {
  const shiftsSnap = await db.collection('orgs').doc(orgId).collection('shifts')
    .where('status', '==', 'in_progress')
    .get();
  const openShiftMap = new Map(shiftsSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));

  const entriesSnap = await db.collection('orgs').doc(orgId).collection('timeEntries')
    .orderBy('createdAt', 'desc')
    .limit(maxEntries)
    .get();

  const entryRepairs = [];
  const shiftRepairs = new Map();

  for (const doc of entriesSnap.docs) {
    const entry = { id: doc.id, ...doc.data() };
    const checkOutMs = toMillis(entry.checkOutAt);
    if (checkOutMs <= 0) continue;

    const needsEntryRepair = entry.onBreak === true || !!entry.breakStartedAt;
    if (needsEntryRepair) {
      entryRepairs.push({
        ref: doc.ref,
        id: doc.id,
        shiftId: String(entry.shiftId || '').trim(),
        checkOutAt: entry.checkOutAt,
        totalBreakMs: Number(entry.totalBreakMs || 0),
        breakStartedAt: entry.breakStartedAt || null,
        onBreak: entry.onBreak === true,
      });
    }

    const shiftId = String(entry.shiftId || '').trim();
    const shift = openShiftMap.get(shiftId);
    if (!shift) continue;
    if (String(shift.assignedUserId || '').trim() !== String(entry.userId || '').trim()) continue;

    const prev = shiftRepairs.get(shiftId);
    if (!prev || toMillis(prev.checkOutAt) < checkOutMs) {
      shiftRepairs.set(shiftId, {
        ref: db.collection('orgs').doc(orgId).collection('shifts').doc(shiftId),
        shiftId,
        entryId: doc.id,
        actorUserId: String(entry.userId || '').trim() || null,
        checkOutAt: entry.checkOutAt,
      });
    }
  }

  if (dryRun) {
    return {
      orgId,
      dryRun: true,
      entryRepairs,
      shiftRepairs: Array.from(shiftRepairs.values()),
    };
  }

  for (const item of entryRepairs) {
    const patch = {
      onBreak: false,
      breakStartedAt: null,
      updatedAt: Timestamp.now(),
    };
    const breakStartedMs = toMillis(item.breakStartedAt);
    const checkOutMs = toMillis(item.checkOutAt);
    if (item.onBreak && breakStartedMs > 0 && checkOutMs >= breakStartedMs) {
      patch.totalBreakMs = Math.max(0, item.totalBreakMs) + Math.max(0, checkOutMs - breakStartedMs);
    }
    await item.ref.set(patch, { merge: true });
  }

  for (const item of shiftRepairs.values()) {
    await item.ref.set({
      status: 'completed',
      clockOutAt: item.checkOutAt,
      updatedAt: Timestamp.now(),
      auditLog: FieldValue.arrayUnion({
        action: 'CLOCKED_OUT_BY_REPAIR_SCRIPT',
        actorUserId: item.actorUserId,
        at: Timestamp.now(),
        note: `Shift closed by local repair script. TimeEntry: ${item.entryId}`,
      }),
    }, { merge: true });
  }

  return {
    orgId,
    dryRun: false,
    entryRepairs,
    shiftRepairs: Array.from(shiftRepairs.values()),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const orgIds = await loadOrgIds(args.orgId);
  if (!orgIds.length) {
    console.log('No organizations found.');
    return;
  }

  console.log(`Repair scan started. orgs=${orgIds.length} dryRun=${args.dryRun} maxEntries=${args.maxEntries}`);

  let totalEntries = 0;
  let totalShifts = 0;
  for (const orgId of orgIds) {
    const result = await repairOrg(orgId, args.dryRun, args.maxEntries);
    totalEntries += result.entryRepairs.length;
    totalShifts += result.shiftRepairs.length;

    console.log(`\n[${orgId}] entryRepairs=${result.entryRepairs.length} shiftRepairs=${result.shiftRepairs.length}`);
    for (const item of result.entryRepairs.slice(0, 20)) {
      console.log(`  entry ${item.id} shift=${item.shiftId || 'n/a'} checkout=${iso(item.checkOutAt)} onBreak=${item.onBreak}`);
    }
    for (const item of result.shiftRepairs.slice(0, 20)) {
      console.log(`  shift ${item.shiftId} closedFromEntry=${item.entryId} checkout=${iso(item.checkOutAt)}`);
    }
  }

  console.log(`\nDone. totalEntryRepairs=${totalEntries} totalShiftRepairs=${totalShifts} dryRun=${args.dryRun}`);
}

main().catch((error) => {
  console.error('Repair failed:', error);
  process.exitCode = 1;
});
