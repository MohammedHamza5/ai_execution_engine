import { resourceIntelligence } from "../resources/resourceIntelligence.js";
import { ResourceDecisionEngine } from "../engine/resourceDecisionEngine.js";
import { db } from "../db/client.js";

async function main() {
  const candidates = await resourceIntelligence.loadNormalizedCandidates();
  const decision = ResourceDecisionEngine.evaluate(candidates, {
    requirements: { requiredCapabilities: ["text"] },
    policy: { allowPaid: false }
  });

  console.log("Decision Type:", decision.decisionType);
  console.log("Selected Candidate:", decision.selectedCandidate?.candidate.providerSlug, decision.selectedCandidate?.candidate.modelSlug);
  console.log("Reasons:", decision.reasons);

  console.log("Eligible Count:", decision.eligibility.eligible.length);
  console.log("Excluded Count:", decision.eligibility.excluded.length);
  for (const inel of decision.eligibility.excluded) {
    console.log(`  EXCLUDED: [${inel.candidate.providerSlug}] ${inel.candidate.modelSlug} -> Reasons: ${inel.rejectionReason} (${inel.message})`);
  }

  console.log("\nTop Ranked Candidates:");
  decision.rankedCandidates.slice(0, 8).forEach((r, idx) => {
    console.log(`${idx + 1}. [${r.candidate.providerSlug}] ${r.candidate.modelSlug}`);
    console.log(`   Score: ${r.totalScore} | Priority: ${r.candidate.priority} | Health: ${r.candidate.health}`);
    console.log(`   Dimension Scores:`, r.dimensionScores);
  });

  await db.close();
  process.exit(0);
}

main().catch(console.error);
