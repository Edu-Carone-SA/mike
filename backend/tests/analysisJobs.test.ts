import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  isTerminal,
  InvalidTransitionError,
  type JobState,
} from "../src/lib/analysisJobs";

describe("analysis job state machine", () => {
  describe("isTerminal", () => {
    it("completed, failed, cancelled are terminal", () => {
      expect(isTerminal("completed")).toBe(true);
      expect(isTerminal("failed")).toBe(true);
      expect(isTerminal("cancelled")).toBe(true);
    });

    it("active states and paused are not terminal", () => {
      for (const s of [
        "queued",
        "planning",
        "running",
        "waiting_retry",
        "paused",
      ] as JobState[]) {
        expect(isTerminal(s)).toBe(false);
      }
    });
  });

  describe("canTransition", () => {
    it("happy path: queued -> planning -> running -> completed", () => {
      expect(canTransition("queued", "planning")).toBe(true);
      expect(canTransition("planning", "running")).toBe(true);
      expect(canTransition("running", "completed")).toBe(true);
    });

    it("queued can fast-path to running", () => {
      expect(canTransition("queued", "running")).toBe(true);
    });

    it("running <-> waiting_retry allows retry loop", () => {
      expect(canTransition("running", "waiting_retry")).toBe(true);
      expect(canTransition("waiting_retry", "running")).toBe(true);
    });

    it("running -> paused on tool budget exhaustion, paused -> running on resume", () => {
      expect(canTransition("running", "paused")).toBe(true);
      expect(canTransition("paused", "running")).toBe(true);
    });

    it("paused can be finalized", () => {
      expect(canTransition("paused", "completed")).toBe(true);
      expect(canTransition("paused", "failed")).toBe(true);
      expect(canTransition("paused", "cancelled")).toBe(true);
    });

    it("any active state can be cancelled", () => {
      for (const s of [
        "queued",
        "planning",
        "running",
        "waiting_retry",
        "paused",
      ] as JobState[]) {
        expect(canTransition(s, "cancelled")).toBe(true);
      }
    });

    it("terminal states never transition again", () => {
      for (const s of [
        "completed",
        "failed",
        "cancelled",
      ] as JobState[]) {
        for (const to of [
          "queued",
          "planning",
          "running",
          "waiting_retry",
          "paused",
          "completed",
          "failed",
          "cancelled",
        ] as JobState[]) {
          expect(canTransition(s, to)).toBe(false);
        }
      }
    });

    it("no backwards transitions from active states", () => {
      expect(canTransition("planning", "queued")).toBe(false);
      expect(canTransition("running", "queued")).toBe(false);
      expect(canTransition("running", "planning")).toBe(false);
      expect(canTransition("waiting_retry", "planning")).toBe(false);
    });

    it("paused cannot go back to queued or planning", () => {
      expect(canTransition("paused", "queued")).toBe(false);
      expect(canTransition("paused", "planning")).toBe(false);
      expect(canTransition("paused", "waiting_retry")).toBe(false);
    });
  });

  describe("assertTransition", () => {
    it("passes on a valid transition", () => {
      expect(() => assertTransition("running", "paused")).not.toThrow();
    });

    it("throws InvalidTransitionError on invalid transition", () => {
      expect(() => assertTransition("completed", "running")).toThrowError(
        InvalidTransitionError,
      );
      expect(() => assertTransition("completed", "running")).toThrowError(
        "completed -> running",
      );
    });
  });
});
