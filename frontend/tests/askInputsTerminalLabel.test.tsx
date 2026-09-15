/**
 * P1 QA 15/09/2026 (reaceite #99, job 868ed996 / chat 75201fb1): after the
 * G04 integrity block, the persisted ask_inputs (choice) kept the message
 * wrapper in "Working" even though the job was terminal (`completed`) —
 * the spinner label must follow the terminal state, not the presence of an
 * unanswered picker.
 *
 * Tests the REAL label logic of PreResponseWrapper (imported, not copied).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreResponseWrapper } from "../src/app/components/assistant/PreResponseWrapper";

describe("PreResponseWrapper — pending ask_inputs must not read 'Working'", () => {
    it("completed job with pending picker shows Completed, not Working", () => {
        render(
            <PreResponseWrapper
                terminalState="completed"
                stepCount={5}
                shouldMinimize={false}
                isStreaming={false}
                forceOpen
            >
                <div>blocked-by-integrity + ask_inputs choice</div>
            </PreResponseWrapper>,
        );
        expect(screen.getByText("Completed in 5 steps")).toBeTruthy();
        expect(screen.queryByText("Working")).toBeNull();
    });

    it("a genuinely streaming group still shows Working", () => {
        render(
            <PreResponseWrapper
                terminalState={undefined}
                stepCount={3}
                shouldMinimize={false}
                isStreaming
            >
                <div>streaming…</div>
            </PreResponseWrapper>,
        );
        expect(screen.getByText("Working")).toBeTruthy();
    });

    it("failed run reads Failed even with the group forced open", () => {
        render(
            <PreResponseWrapper
                terminalState="failed"
                stepCount={2}
                shouldMinimize={false}
                isStreaming={false}
                forceOpen
            >
                <div>edit blocked</div>
            </PreResponseWrapper>,
        );
        expect(screen.getByText("Failed after 2 steps")).toBeTruthy();
    });
});
