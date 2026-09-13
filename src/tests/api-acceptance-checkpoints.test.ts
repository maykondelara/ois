import { describe, expect, it } from "vitest";
import {
  createPhase3a3CheckpointLedger,
  phase3a3ApiAcceptanceCheckpoints,
} from "../../poc/phase3a3-api-acceptance-checkpoints";
import {
  createPhase3b3CheckpointLedger,
  phase3b3ApiAcceptanceCheckpoints,
} from "../../poc/phase3b3-api-acceptance-checkpoints";

describe("Phase 3A.3 executable acceptance checkpoints", () => {
  it("requires every manifest checkpoint to be emitted exactly once", () => {
    const emitted: string[] = [];
    const ledger = createPhase3a3CheckpointLedger((name, passed) => {
      expect(passed).toBe(true);
      emitted.push(name);
    });

    for (const name of phase3a3ApiAcceptanceCheckpoints) ledger.checkpoint(name, true);

    expect(() => ledger.assertComplete()).not.toThrow();
    expect(emitted).toEqual(phase3a3ApiAcceptanceCheckpoints);
    expect(() => ledger.checkpoint(phase3a3ApiAcceptanceCheckpoints[0], true)).toThrow(
      "emitted more than once",
    );
  });

  it("fails acceptance completion when a manifest checkpoint was not emitted", () => {
    const ledger = createPhase3a3CheckpointLedger(() => undefined);
    ledger.checkpoint(phase3a3ApiAcceptanceCheckpoints[0], true);

    expect(() => ledger.assertComplete()).toThrow("not emitted");
  });
});

describe("Phase 3B.3 executable acceptance checkpoints", () => {
  it("requires every Phase 3B.3 HTTP checkpoint exactly once", () => {
    const emitted: string[] = [];
    const ledger = createPhase3b3CheckpointLedger((name, passed) => {
      expect(passed).toBe(true);
      emitted.push(name);
    });
    for (const name of phase3b3ApiAcceptanceCheckpoints) ledger.checkpoint(name, true);
    expect(() => ledger.assertComplete()).not.toThrow();
    expect(emitted).toEqual(phase3b3ApiAcceptanceCheckpoints);
  });
});
