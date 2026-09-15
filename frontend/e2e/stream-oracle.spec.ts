import { test, expect } from "@playwright/test";
import {
    login,
    selectModel,
    sendAndAwaitTurn,
    ORACLE_PROMPT,
    ORACLE_EXPECTED,
} from "./helpers";

/**
 * P0 stream oracle (QA report 14/09/2026) — the exact acceptance the QA
 * applies: the full answer must be in the DOM before the terminal label,
 * in a brand-new standalone chat, no reload, per published model.
 *
 * The QA demands 30/30 per model; locally we default to a smaller matrix
 * (scale with MIKE_E2E_RUNS) and ALWAYS report the real pass rate.
 */
const RUNS = Number(process.env.MIKE_E2E_RUNS ?? 3);

const MODELS = [
    { label: "GLM 5.3 Flash" },
    { label: "DeepSeek V4.1 Flash" },
];

for (const model of MODELS) {
    test(`stream oracle — ${model.label}`, async ({ page }) => {
        await login(page);
        await page.goto("/assistant");
        await selectModel(page, model.label);

        let pass = 0;
        const failures: string[] = [];
        for (let i = 0; i < RUNS; i++) {
            // A brand-new standalone chat per run: force the new-chat path.
            await page.goto("/assistant");
            const answer = await sendAndAwaitTurn(page, ORACLE_PROMPT);
            if (answer.includes(ORACLE_EXPECTED)) {
                pass++;
            } else {
                failures.push(`run ${i + 1}: got ${JSON.stringify(answer.slice(0, 80))}`);
            }
        }
        // Assert with the real rate in the message — no silent retries.
        expect(
            pass,
            `${model.label}: ${pass}/${RUNS} passed. Failures: ${failures.join(" | ")}`,
        ).toBe(RUNS);
    });
}
