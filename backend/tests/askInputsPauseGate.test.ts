/**
 * P0 QA 15/09/2026 (PR #97 reaceite, chat d5b8e519 R25): GLM opened
 * ask_inputs on a fully-specified one-line sentinel with no document and
 * no workflow. shouldEmitAskInputsPause is the real gate — imported from
 * the dispatcher, never a local copy.
 */
import { describe, it, expect } from "vitest";
import { shouldEmitAskInputsPause } from "../src/lib/chat/tools/toolDispatcher";

describe("shouldEmitAskInputsPause — P0 no picker on a specified sentinel", () => {
    const choice = [{ kind: "choice" }];
    const docs = [{ kind: "documents" }];

    it("blocks a choice-only picker with no document and no workflow (R25)", () => {
        expect(
            shouldEmitAskInputsPause({
                items: choice,
                hasAttachedDocuments: false,
                hasWorkflow: false,
            }),
        ).toBe(false);
    });

    it("allows a documents-kind request even with no current attachment", () => {
        expect(
            shouldEmitAskInputsPause({
                items: docs,
                hasAttachedDocuments: false,
                hasWorkflow: false,
            }),
        ).toBe(true);
    });

    it("allows a choice picker when a document is already in the turn", () => {
        expect(
            shouldEmitAskInputsPause({
                items: choice,
                hasAttachedDocuments: true,
                hasWorkflow: false,
            }),
        ).toBe(true);
    });

    it("allows a choice picker when a workflow is in play", () => {
        expect(
            shouldEmitAskInputsPause({
                items: choice,
                hasAttachedDocuments: false,
                hasWorkflow: true,
            }),
        ).toBe(true);
    });

    it("does not pause on an empty items array", () => {
        expect(
            shouldEmitAskInputsPause({
                items: [],
                hasAttachedDocuments: true,
                hasWorkflow: true,
            }),
        ).toBe(false);
    });
});
