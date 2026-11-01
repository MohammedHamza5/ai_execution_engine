import { resourceIntelligence } from "../../src/resources/resourceIntelligence.js";
import { ResourceDecisionEngine } from "../../src/engine/resourceDecisionEngine.js";
import { db } from "../../src/db/client.js";

async function printAllScores() {
  const candidates = await resourceIntelligence.loadNormalizedCandidates();
  const decision = ResourceDecisionEngine.evaluate(candidates, {});
  console.log("DECISION TYPE:", decision.decisionType);
  console.log("SELECTED:", decision.selectedCandidate?.candidate.providerSlug, decision.selectedCandidate?.candidate.modelSlug);
  console.log("\nRANKED CANDIDATES:");
  decision.rankedCandidates.forEach((sc, i) => {
    console.log(
      `#${i + 1}: ${sc.candidate.providerSlug.padEnd(12)} (${sc.candidate.modelSlug.padEnd(25)}) -> Total: ${sc.totalScore.toFixed(4)} | Latency: ${sc.dimensionScores.latency} | Quota: ${sc.dimensionScores.capacity} | Rel: ${sc.dimensionScores.reliability}`
    );
  });
  await db.close();
}

printAllScores().catch(console.error);
