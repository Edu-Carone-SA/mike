import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for staging E2E — the real user path, no API shortcuts.
 */

export const QA_EMAIL = process.env.MIKE_QA_EMAIL ?? "m06-smoke-001@atlasgov.com";
export const QA_PASSWORD = process.env.MIKE_QA_PASSWORD ?? "";

export async function login(page: Page) {
    if (!QA_PASSWORD) {
        throw new Error(
            "MIKE_QA_PASSWORD is not set — refusing to run E2E without real credentials",
        );
    }
    await page.goto("/login");
    const email = page.locator('input[type="email"]');
    if (await email.isVisible({ timeout: 15_000 }).catch(() => false)) {
        await email.fill(QA_EMAIL);
        await page.locator('input[type="password"]').fill(QA_PASSWORD);
        await page.locator('button[type="submit"]').click();
    }
    // The composer textarea is the authenticated landmark on /assistant.
    await expect(page.locator("textarea")).toBeVisible({ timeout: 60_000 });
}

/**
 * The QA oracle (P0 stream, 14/09/2026). Verbatim from the report —
 * the only accepted answer is the full string visible in the DOM
 * BEFORE the terminal label, without any reload.
 */
export const ORACLE_PROMPT =
    "Responda exatamente nesta única linha: RESULTADO_ASSISTENTE=COMPLETO; FIM_ASSISTENTE=OK.";
export const ORACLE_EXPECTED = "RESULTADO_ASSISTENTE=COMPLETO; FIM_ASSISTENTE=OK.";

/**
 * Selects a model in the composer dropdown by its visible label.
 * The selector is a plain button (text + chevron) inside the composer
 * card; options render as clickable rows once the popover opens.
 */
export async function selectModel(page: Page, label: string) {
    // Open the dropdown: the composer button whose text matches the model.
    const trigger = page
        .locator("button", { hasText: /GLM|DeepSeek|Model/i })
        .filter({ has: page.locator(":scope") })
        .last();
    await trigger.click();

    // Options appear in the popover; pick the one matching the label.
    const option = page
        .locator(`div[role="option"], [role="menuitem"], li, button, div`)
        .filter({ hasText: new RegExp(label, "i") })
        .last();
    await option.click();
}

/**
 * Sends a message in a brand-new standalone chat and returns the LAST
 * assistant turn's rendered text (the region of the message stream, not
 * the sidebar — chat titles echo the prompt and would false-positive).
 */
export async function sendAndAwaitTurn(
    page: Page,
    prompt: string,
    timeout = 60_000,
): Promise<string> {
    const composer = page.locator("textarea").last();
    await composer.fill(prompt);
    await composer.press("Enter");

    // The terminal label is the turn-end signal.
    const terminal = page
        .locator("text=/Completed in|Resposta concluída/i")
        .last();
    await expect(terminal).toBeVisible({ timeout });

    // The assistant answer is the last message block in the stream region.
    const stream = page.locator("main").last();
    const text = await stream.innerText();
    // Last occurrence of the prompt starts the final turn; the answer is
    // everything between it and the terminal label.
    const pIdx = text.lastIndexOf(prompt);
    const after = pIdx >= 0 ? text.slice(pIdx + prompt.length) : text;
    const cIdx = after.search(/Completed in|Resposta concluída/i);
    return (cIdx >= 0 ? after.slice(0, cIdx) : after).trim();
}
