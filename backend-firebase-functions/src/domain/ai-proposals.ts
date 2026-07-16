import { randomUUID } from 'crypto';

/**
 * Shared shape for AI-staged actions — used by both the interactive
 * AI Copilot chat (aiAssistantChat) and the scheduled daily digest
 * (dailyDigest). Neither producer ever writes to Firestore directly;
 * a Proposal is only executed client-side, after explicit admin
 * confirmation, via the same already-audited callables the rest of
 * the app uses (createShift, assignShift, publishShift, unassignShift).
 */
export interface Proposal {
  id: string;
  kind: 'create_shift' | 'assign_shift' | 'publish_shift' | 'unassign_shift';
  summary: string;
  payload: Record<string, unknown>;
}

export function buildProposal(toolName: string, input: any): Proposal {
  const id = randomUUID();
  switch (toolName) {
    case 'propose_create_shift':
      return {
        id,
        kind: 'create_shift',
        summary: `Create "${input.title}" at ${input.locationName}`,
        payload: {
          title: String(input.title || ''),
          locationName: String(input.locationName || ''),
          startAtMs: Number(input.startAtMs),
          endAtMs: Number(input.endAtMs),
          requiredJobRole: input.requiredJobRole ? String(input.requiredJobRole) : null,
          payRate: input.payRate != null ? Number(input.payRate) : null,
          notes: input.notes ? String(input.notes) : null,
        },
      };
    case 'propose_assign_shift':
      return {
        id,
        kind: 'assign_shift',
        summary: `Assign ${input.assigneeLabel || input.assigneeUid} to ${input.shiftLabel || input.shiftId}`,
        payload: { shiftId: String(input.shiftId), assigneeUid: String(input.assigneeUid) },
      };
    case 'propose_publish_shift':
      return {
        id,
        kind: 'publish_shift',
        summary: `Publish ${input.shiftLabel || input.shiftId} to the marketplace`,
        payload: { shiftId: String(input.shiftId) },
      };
    case 'propose_unassign_shift':
      return {
        id,
        kind: 'unassign_shift',
        summary: `Unassign staff from ${input.shiftLabel || input.shiftId}`,
        payload: { shiftId: String(input.shiftId) },
      };
    default:
      throw new Error(`Unknown proposal tool: ${toolName}`);
  }
}
