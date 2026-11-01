import { ModelTaxonomyProfile } from "../domain/resource/taxonomyTypes.js";
import { getGeminiFleet } from "./fleet/geminiFleet.js";
import { getGroqFleet } from "./fleet/groqFleet.js";
import { getCloudflareFleet } from "./fleet/cloudflareFleet.js";
import { getOpenRouterFleet } from "./fleet/openrouterFleet.js";

export interface FleetResourceConfig {
  providerSlug: string;
  providerName: string;
  providerType: string;
  modelSlug: string;
  modelName: string;
  modelFamily: string;
  capabilities: string[];
  credentialName: string;
  secretRef: string;
  priority: number;
  rpmQuota: number;
  taxonomy?: ModelTaxonomyProfile;
}

export function buildFleetConfigs(): FleetResourceConfig[] {
  return [
    ...getGeminiFleet(),
    ...getGroqFleet(),
    ...getCloudflareFleet(),
    ...getOpenRouterFleet(),
  ];
}
