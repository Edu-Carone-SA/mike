import { defineConfig } from "@playwright/test";

/**
 * E2E against the deployed staging environment (the same path the QA walks).
 * Credentials come from env vars — never from the repo:
 *   MIKE_QA_EMAIL / MIKE_QA_PASSWORD
 * The staged smoke account is the default; the QA account works too when set.
 */
const BASE_URL = process.env.MIKE_E2E_BASE_URL ?? "https://mike.agov.app";

export default defineConfig({
    testDir: "./e2e",
    testMatch: "stream-oracle.spec.ts",
    timeout: 120_000,
    fullyParallel: false, // sequential: chat turns share an account
    retries: 0, // a flaky oracle must FAIL, not retry into a pass
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: BASE_URL,
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
        viewport: { width: 1440, height: 900 },
    },
    outputDir: "./e2e-results",
});
