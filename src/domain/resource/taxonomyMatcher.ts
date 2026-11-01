import {
  ModelTaxonomyProfile,
  TaxonomyMatchingCriteria,
  InputModality,
  OutputModality,
} from "./taxonomyTypes.js";

export interface TaxonomyMatchResult {
  readonly compatible: boolean;
  readonly matchScore: number;
  readonly modalityScore: number;
  readonly archetypeScore: number;
  readonly tierScore: number;
  readonly reasons: ReadonlyArray<string>;
}

export function matchTaxonomy(
  profile: ModelTaxonomyProfile,
  criteria: TaxonomyMatchingCriteria
): TaxonomyMatchResult {
  const reasons: string[] = [];

  // 1. Hard Check: Required Input Modalities
  if (criteria.requiredInputs && criteria.requiredInputs.length > 0) {
    const missingInputs = criteria.requiredInputs.filter(
      (req) => !profile.modalities.inputs.includes(req)
    );
    if (missingInputs.length > 0) {
      reasons.push(`Model missing required inputs: ${missingInputs.join(", ")}`);
      return {
        compatible: false,
        matchScore: 0,
        modalityScore: 0,
        archetypeScore: 0,
        tierScore: 0,
        reasons,
      };
    }
  }

  // 2. Hard Check: Required Output Modalities
  if (criteria.requiredOutputs && criteria.requiredOutputs.length > 0) {
    const missingOutputs = criteria.requiredOutputs.filter(
      (req) => !profile.modalities.outputs.includes(req)
    );
    if (missingOutputs.length > 0) {
      reasons.push(`Model missing required outputs: ${missingOutputs.join(", ")}`);
      return {
        compatible: false,
        matchScore: 0,
        modalityScore: 0,
        archetypeScore: 0,
        tierScore: 0,
        reasons,
      };
    }
  }

  // 3. Hard Check: Domain Specialization
  if (criteria.requiredDomain) {
    const hasDomain =
      profile.specializedDomains &&
      profile.specializedDomains.some(
        (d) => d.toLowerCase() === criteria.requiredDomain!.toLowerCase()
      );
    if (!hasDomain) {
      reasons.push(`Model lacks specialized domain: ${criteria.requiredDomain}`);
      return {
        compatible: false,
        matchScore: 0,
        modalityScore: 0,
        archetypeScore: 0,
        tierScore: 0,
        reasons,
      };
    }
  }

  // 4. Soft Scoring
  const modalityScore = 1.0;

  // Archetype Scoring
  let archetypeScore = 1.0;
  if (criteria.preferredArchetype) {
    if (profile.archetype === criteria.preferredArchetype) {
      archetypeScore = 1.0;
    } else if (
      profile.archetype === "REASONING_DELIBERATIVE" &&
      criteria.preferredArchetype === "DEEP_SYNTHESIS"
    ) {
      archetypeScore = 0.8;
    } else if (
      profile.archetype === "FAST_REFLEX" &&
      criteria.preferredArchetype === "CLASSIFICATION_GUARD"
    ) {
      archetypeScore = 0.85;
    } else if (profile.archetype === "EMBEDDING_RETRIEVAL") {
      archetypeScore = 0.1; // Dedicated embedding model unsuitable for general logic
    } else {
      archetypeScore = 0.5;
    }
  }

  // Tier Scoring
  let tierScore = 1.0;
  if (criteria.preferredTier) {
    if (profile.tier === criteria.preferredTier) {
      tierScore = 1.0;
    } else if (
      criteria.preferredTier === "EDGE_LIGHT" &&
      profile.tier === "BALANCED_WORKHORSE"
    ) {
      tierScore = 0.85; // acceptable upgrade
    } else if (
      criteria.preferredTier === "FRONTIER_HEAVYWEIGHT" &&
      profile.tier === "EDGE_LIGHT"
    ) {
      tierScore = 0.35; // underpowered
    } else {
      tierScore = 0.6;
    }
  }

  const matchScore = Number(
    (0.5 * modalityScore + 0.3 * archetypeScore + 0.2 * tierScore).toFixed(4)
  );

  return {
    compatible: true,
    matchScore,
    modalityScore,
    archetypeScore,
    tierScore,
    reasons: reasons.length > 0 ? reasons : ["Fully compatible"],
  };
}

export function inferInputModalityFromMime(mimeType: string): InputModality {
  const lower = mimeType.toLowerCase().trim();
  if (lower.startsWith("image/")) return "IMAGE";
  if (lower.startsWith("audio/")) return "AUDIO";
  if (lower.startsWith("video/")) return "VIDEO";
  if (lower === "application/pdf") return "DOCUMENT_PDF";
  if (lower === "application/json") return "STRUCTURED_DATA";
  return "TEXT";
}

export function inferOutputModalityFromMime(mimeType: string): OutputModality {
  const lower = mimeType.toLowerCase().trim();
  if (lower.startsWith("image/")) return "IMAGE";
  if (lower.startsWith("audio/")) return "AUDIO";
  if (lower.startsWith("video/")) return "VIDEO";
  if (lower === "application/json") return "STRUCTURED_JSON";
  if (lower === "application/x-embedding") return "EMBEDDING";
  return "TEXT";
}
