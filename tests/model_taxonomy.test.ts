import { describe, it, expect } from "vitest";
import {
  matchTaxonomy,
  inferInputModalityFromMime,
  inferOutputModalityFromMime,
} from "../src/domain/resource/taxonomyMatcher.js";
import { ModelTaxonomyProfile } from "../src/domain/resource/taxonomyTypes.js";
import { buildFleetConfigs } from "../src/resources/fleetSeedConfig.js";

describe("Universal Model Taxonomy & Matcher", () => {
  const geminiProfile: ModelTaxonomyProfile = {
    modalities: {
      inputs: ["TEXT", "IMAGE", "AUDIO", "DOCUMENT_PDF", "STRUCTURED_DATA"],
      outputs: ["TEXT", "STRUCTURED_JSON"],
    },
    archetype: "DEEP_SYNTHESIS",
    tier: "BALANCED_WORKHORSE",
    specializedDomains: ["VISION_OCR", "DOCUMENT_PARSING"],
  };

  const groqReasoningProfile: ModelTaxonomyProfile = {
    modalities: {
      inputs: ["TEXT"],
      outputs: ["TEXT"],
    },
    archetype: "REASONING_DELIBERATIVE",
    tier: "FRONTIER_HEAVYWEIGHT",
    specializedDomains: ["REASONING", "MATH", "SYSTEMS_ARCHITECTURE"],
  };

  const bgeEmbeddingProfile: ModelTaxonomyProfile = {
    modalities: {
      inputs: ["TEXT"],
      outputs: ["EMBEDDING"],
    },
    archetype: "EMBEDDING_RETRIEVAL",
    tier: "EDGE_LIGHT",
    specializedDomains: ["SEMANTIC_SEARCH", "VECTOR_EMBEDDINGS"],
  };

  const allamArabicProfile: ModelTaxonomyProfile = {
    modalities: {
      inputs: ["TEXT"],
      outputs: ["TEXT"],
    },
    archetype: "FAST_REFLEX",
    tier: "EDGE_LIGHT",
    specializedDomains: ["ARABIC_NLP", "LOCALIZATION"],
  };

  describe("I/O Modality Compatibility", () => {
    it("should accept multimodal audio/image inputs for multimodal model", () => {
      const res = matchTaxonomy(geminiProfile, {
        requiredInputs: ["AUDIO", "DOCUMENT_PDF"],
        requiredOutputs: ["TEXT"],
      });
      expect(res.compatible).toBe(true);
      expect(res.matchScore).toBeGreaterThan(0.8);
    });

    it("should strictly reject text-only model when audio input is required", () => {
      const res = matchTaxonomy(groqReasoningProfile, {
        requiredInputs: ["AUDIO"],
        requiredOutputs: ["TEXT"],
      });
      expect(res.compatible).toBe(false);
      expect(res.matchScore).toBe(0);
      expect(res.reasons[0]).toContain("missing required inputs: AUDIO");
    });

    it("should strictly match embedding models for vector indexing requests", () => {
      const res = matchTaxonomy(bgeEmbeddingProfile, {
        requiredInputs: ["TEXT"],
        requiredOutputs: ["EMBEDDING"],
      });
      expect(res.compatible).toBe(true);
      expect(res.matchScore).toBeGreaterThan(0.8);
    });

    it("should reject generative text model when EMBEDDING output is strictly required", () => {
      const res = matchTaxonomy(geminiProfile, {
        requiredInputs: ["TEXT"],
        requiredOutputs: ["EMBEDDING"],
      });
      expect(res.compatible).toBe(false);
      expect(res.matchScore).toBe(0);
      expect(res.reasons[0]).toContain("missing required outputs: EMBEDDING");
    });
  });

  describe("Cognitive Archetype & Tier Scoring", () => {
    it("should assign high archetype score to deliberative reasoning models for math tasks", () => {
      const res = matchTaxonomy(groqReasoningProfile, {
        requiredInputs: ["TEXT"],
        preferredArchetype: "REASONING_DELIBERATIVE",
        preferredTier: "FRONTIER_HEAVYWEIGHT",
      });
      expect(res.compatible).toBe(true);
      expect(res.archetypeScore).toBe(1.0);
      expect(res.tierScore).toBe(1.0);
      expect(res.matchScore).toBe(1.0);
    });

    it("should penalize underpowered tier when frontier heavyweight is preferred", () => {
      const res = matchTaxonomy(allamArabicProfile, {
        requiredInputs: ["TEXT"],
        preferredTier: "FRONTIER_HEAVYWEIGHT",
      });
      expect(res.compatible).toBe(true);
      expect(res.tierScore).toBe(0.35);
      expect(res.matchScore).toBe(0.87);
    });

    it("should enforce required specialized domain", () => {
      const matchSuccess = matchTaxonomy(allamArabicProfile, {
        requiredInputs: ["TEXT"],
        requiredDomain: "ARABIC_NLP",
      });
      expect(matchSuccess.compatible).toBe(true);

      const matchFail = matchTaxonomy(groqReasoningProfile, {
        requiredInputs: ["TEXT"],
        requiredDomain: "ARABIC_NLP",
      });
      expect(matchFail.compatible).toBe(false);
      expect(matchFail.reasons[0]).toContain("lacks specialized domain: ARABIC_NLP");
    });
  });

  describe("MIME Type Inference", () => {
    it("should infer correct input and output modalities from MIME types", () => {
      expect(inferInputModalityFromMime("audio/mp3")).toBe("AUDIO");
      expect(inferInputModalityFromMime("audio/wav")).toBe("AUDIO");
      expect(inferInputModalityFromMime("image/png")).toBe("IMAGE");
      expect(inferInputModalityFromMime("application/pdf")).toBe("DOCUMENT_PDF");
      expect(inferInputModalityFromMime("application/json")).toBe("STRUCTURED_DATA");
      expect(inferInputModalityFromMime("text/markdown")).toBe("TEXT");

      expect(inferOutputModalityFromMime("audio/wav")).toBe("AUDIO");
      expect(inferOutputModalityFromMime("image/png")).toBe("IMAGE");
      expect(inferOutputModalityFromMime("application/json")).toBe("STRUCTURED_JSON");
      expect(inferOutputModalityFromMime("application/x-embedding")).toBe("EMBEDDING");
      expect(inferOutputModalityFromMime("text/plain")).toBe("TEXT");
    });
  });

  describe("Fleet Seed Taxonomy Verification", () => {
    it("should verify all seeded fleet models have valid taxonomy profiles", () => {
      const fleet = buildFleetConfigs();
      expect(fleet.length).toBe(17);

      for (const item of fleet) {
        expect(item.taxonomy).toBeDefined();
        expect(item.taxonomy!.modalities.inputs.length).toBeGreaterThan(0);
        expect(item.taxonomy!.modalities.outputs.length).toBeGreaterThan(0);
        expect(item.taxonomy!.archetype).toBeDefined();
        expect(item.taxonomy!.tier).toBeDefined();
      }

      // Verify Cloudflare BGE is dedicated embedding
      const bge = fleet.find((f) => f.modelSlug === "@cf/baai/bge-large-en-v1.5");
      expect(bge?.taxonomy?.archetype).toBe("EMBEDDING_RETRIEVAL");
      expect(bge?.taxonomy?.modalities.outputs).toContain("EMBEDDING");

      // Verify Gemini fleet supports audio and vision
      const gemini = fleet.find((f) => f.providerSlug === "gemini");
      expect(gemini?.taxonomy?.modalities.inputs).toContain("AUDIO");
      expect(gemini?.taxonomy?.modalities.inputs).toContain("IMAGE");
      expect(gemini?.taxonomy?.modalities.inputs).toContain("DOCUMENT_PDF");
    });
  });
});
