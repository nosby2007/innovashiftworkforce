import { OrganizationExperienceSnapshot } from '../domain/experience-config';

export interface AiIndustryContext {
  /** Spliced into an LLM system prompt in place of the old hardcoded "healthcare" framing. */
  contextLine: string;
  /** A follow-up line telling the model which words this org uses — '' for orgs on the generic default (no bloat for the common case). */
  terminologyHint: string;
}

export const GENERIC_AI_CONTEXT_LINE =
  'You are the InnovaShift AI Copilot, an assistant embedded in a workforce scheduling app.';

interface StoredExperienceConfig {
  configurationStatus: 'legacy' | 'configured';
  snapshot: OrganizationExperienceSnapshot;
}

/**
 * Pure mapping — given a resolved (or absent) experience config doc,
 * decide what to tell the LLM. Legacy orgs (the vast majority today) get
 * the neutral generic line and no terminology hint, matching the
 * frontend's TerminologyService default.
 */
export function resolveAiIndustryContext(config: StoredExperienceConfig | null): AiIndustryContext {
  if (!config || config.configurationStatus !== 'configured') {
    return { contextLine: GENERIC_AI_CONTEXT_LINE, terminologyHint: '' };
  }
  const { ai, terminology } = config.snapshot;
  const contextLine = ai.industryContextPrompt || GENERIC_AI_CONTEXT_LINE;
  const terminologyHint = `This organization calls what it schedules staff for a "${terminology.workUnit.singular}" (plural "${terminology.workUnit.plural}"), and refers to staff as "${terminology.workforceMember.plural}".`;
  return { contextLine, terminologyHint };
}

/** Cloud-Functions-only doc (Admin SDK bypasses Firestore rules) — same raw-read idiom as callable/activateIndustryProfile.ts. */
export async function getAiIndustryContext(db: FirebaseFirestore.Firestore, orgId: string): Promise<AiIndustryContext> {
  try {
    const snap = await db.collection('orgs').doc(orgId).collection('experience').doc('config').get();
    const config = snap.exists ? (snap.data() as StoredExperienceConfig) : null;
    return resolveAiIndustryContext(config);
  } catch {
    return resolveAiIndustryContext(null);
  }
}
