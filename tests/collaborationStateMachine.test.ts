import { describe, it, expect } from "vitest";
import { CollaborationStateMachine } from "../src/engine/collaborationStateMachine.js";
import { CompletionPolicy } from "../src/domain/collaboration/types.js";

describe("M3.1 — Collaboration State Machine & Policy Evaluation", () => {
  describe("State Transitions", () => {
    it("allows standard forward progression lifecycle", () => {
      expect(CollaborationStateMachine.canTransition("CREATED", "PLANNED")).toBe(true);
      expect(CollaborationStateMachine.canTransition("PLANNED", "DISPATCHING")).toBe(true);
      expect(CollaborationStateMachine.canTransition("DISPATCHING", "RUNNING")).toBe(true);
      expect(CollaborationStateMachine.canTransition("RUNNING", "COLLECTING")).toBe(true);
      expect(CollaborationStateMachine.canTransition("COLLECTING", "SYNTHESIZING")).toBe(true);
      expect(CollaborationStateMachine.canTransition("SYNTHESIZING", "VALIDATING")).toBe(true);
      expect(CollaborationStateMachine.canTransition("VALIDATING", "COMPLETED")).toBe(true);
    });

    it("allows recovery lifecycle from partial branch failure", () => {
      expect(CollaborationStateMachine.canTransition("RUNNING", "PARTIAL_FAILURE")).toBe(true);
      expect(CollaborationStateMachine.canTransition("PARTIAL_FAILURE", "RECOVERING")).toBe(true);
      expect(CollaborationStateMachine.canTransition("RECOVERING", "RUNNING")).toBe(true);
    });

    it("prevents any transitions out of terminal states (Terminal State Protection)", () => {
      expect(CollaborationStateMachine.isTerminal("COMPLETED")).toBe(true);
      expect(CollaborationStateMachine.isTerminal("FAILED")).toBe(true);
      expect(CollaborationStateMachine.isTerminal("CANCELLED")).toBe(true);
      expect(CollaborationStateMachine.isTerminal("DEAD_LETTERED")).toBe(true);

      expect(CollaborationStateMachine.canTransition("COMPLETED", "RUNNING")).toBe(false);
      expect(CollaborationStateMachine.canTransition("FAILED", "RUNNING")).toBe(false);
      expect(CollaborationStateMachine.canTransition("CANCELLED", "PLANNED")).toBe(false);
      expect(CollaborationStateMachine.canTransition("DEAD_LETTERED", "CREATED")).toBe(false);
    });

    it("throws when asserting an invalid state transition", () => {
      expect(() => {
        CollaborationStateMachine.assertTransition("CREATED", "COMPLETED");
      }).toThrow("INVALID_COLLABORATION_TRANSITION");
    });

    it("allows idempotent transitions to the same state", () => {
      expect(CollaborationStateMachine.canTransition("RUNNING", "RUNNING")).toBe(true);
    });
  });

  describe("Completion Policy Evaluation", () => {
    it("evaluates ALL_REQUIRED policy correctly", () => {
      const policy: CompletionPolicy = { type: "ALL_REQUIRED" };

      // Case: 3 of 3 completed
      const allDone = CollaborationStateMachine.evaluatePolicy(policy, ["completed", "completed", "completed"]);
      expect(allDone.isSatisfied).toBe(true);
      expect(allDone.canProceedToSynthesis).toBe(true);

      // Case: 2 completed, 1 pending
      const partial = CollaborationStateMachine.evaluatePolicy(policy, ["completed", "completed", "pending"]);
      expect(partial.isSatisfied).toBe(false);
      expect(partial.canProceedToSynthesis).toBe(false);

      // Case: 2 completed, 1 failed
      const failed = CollaborationStateMachine.evaluatePolicy(policy, ["completed", "completed", "failed"]);
      expect(failed.isSatisfied).toBe(false);
      expect(failed.canProceedToSynthesis).toBe(false);
    });

    it("evaluates MINIMUM_SUCCESS policy correctly", () => {
      const policy: CompletionPolicy = { type: "MINIMUM_SUCCESS", minSuccessCount: 2 };

      // 2 completed out of 3, 0 pending
      const res = CollaborationStateMachine.evaluatePolicy(policy, ["completed", "completed", "failed"]);
      expect(res.isSatisfied).toBe(true);
      expect(res.canProceedToSynthesis).toBe(true);

      // 1 completed, 2 failed
      const resFail = CollaborationStateMachine.evaluatePolicy(policy, ["completed", "failed", "failed"]);
      expect(resFail.isSatisfied).toBe(false);
      expect(resFail.canProceedToSynthesis).toBe(false);
    });

    it("evaluates QUORUM policy correctly", () => {
      const policy: CompletionPolicy = { type: "QUORUM", quorumCount: 3 };

      // 3 of 5 completed
      const res = CollaborationStateMachine.evaluatePolicy(policy, [
        "completed",
        "completed",
        "completed",
        "failed",
        "failed",
      ]);
      expect(res.isSatisfied).toBe(true);
      expect(res.canProceedToSynthesis).toBe(true);
    });

    it("evaluates BEST_EFFORT policy correctly", () => {
      const policy: CompletionPolicy = { type: "BEST_EFFORT" };

      // 1 of 3 completed, 0 pending
      const res = CollaborationStateMachine.evaluatePolicy(policy, ["failed", "completed", "failed"]);
      expect(res.isSatisfied).toBe(true);
      expect(res.canProceedToSynthesis).toBe(true);

      // 0 completed
      const allFail = CollaborationStateMachine.evaluatePolicy(policy, ["failed", "failed", "failed"]);
      expect(allFail.isSatisfied).toBe(false);
      expect(allFail.canProceedToSynthesis).toBe(false);
    });
  });
});
