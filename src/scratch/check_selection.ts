import { resourceIntelligence } from "../../src/resources/resourceIntelligence.js";
import { db } from "../../src/db/client.js";

async function checkSelectedResource() {
  const selected = await resourceIntelligence.selectResource({ requiredCapabilities: ["text"] });
  console.log("SELECTED RESOURCE:", {
    id: selected.resource.id,
    provider: selected.providerSlug,
    model: selected.modelSlug,
    secretRef: selected.credentialSecretRef,
  });

  const candidates = await resourceIntelligence.loadNormalizedCandidates();
  console.log(`\nALL ${candidates.length} CANDIDATES:`);
  candidates.forEach(c => {
    console.log(`Provider: ${c.providerSlug.padEnd(12)} | Model: ${c.modelSlug.padEnd(30)} | Priority: ${String(c.priority).padEnd(4)} | Billing: ${c.billingClass} | Secret: ${c.secretReference}`);
  });

  await db.close();
}

checkSelectedResource().catch(console.error);
