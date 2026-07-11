import { test, expect } from "@playwright/test";

/**
 * E2E tests for AWS Staging environment.
 *
 * Credentials are injected via environment variables — never hardcoded.
 * Trace/screenshot/video are disabled for the login step to prevent
 * credential leakage in artifacts.
 */

const BASE_URL = process.env.E2E_STAGING_BASE_URL || "https://mike.agov.app";
const STAGING_USER = process.env.E2E_STAGING_USER || "";
const STAGING_PASSWORD = process.env.E2E_STAGING_PASSWORD || "";

test.beforeAll(() => {
  if (!STAGING_USER || !STAGING_PASSWORD) {
    throw new Error(
      "E2E_STAGING_USER and E2E_STAGING_PASSWORD must be set",
    );
  }
});

test.describe("AWS Staging — login and document workflow", () => {
  test("loads login page", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await expect(page).toHaveTitle(/Mike/);
    await expect(page.locator("h2")).toContainText(/log in/i);
  });

  test("logs in with staging account", async ({ browser }) => {
    // Disable video/trace for this test to protect credentials
    const context = await browser.newContext({
      recordVideo: undefined,
      recordHar: undefined,
    });
    // @ts-expect-error — Playwright supports disabling trace per context
    context._options.trace = "off";

    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`);

    await page.fill('input[type="email"]', STAGING_USER);
    await page.fill('input[type="password"]', STAGING_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for dashboard to load
    await page.waitForURL(BASE_URL, { timeout: 15000 });
    await expect(page.locator("h1")).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test("loads authenticated dashboard", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Login first
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', STAGING_USER);
    await page.fill('input[type="password"]', STAGING_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL(BASE_URL, { timeout: 15000 });

    // Verify dashboard elements
    await expect(page.locator("h1")).toBeVisible({ timeout: 10000 });
    const sidebar = page.locator("nav, [role='navigation']");
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    await context.close();
  });

  test("rejects invalid session", async ({ page }) => {
    // Try accessing a protected API route without auth
    const response = await page.request.get(`${BASE_URL}/projects/`);
    expect(response.status()).toBe(401);
  });

  test("public signup is disabled", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/supabase/auth/v1/signup`, {
      data: {
        email: "e2e-blocked-signup@atlasgov.com",
        password: "ShouldBeBlocked123!",
      },
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.error_code).toBe("signup_disabled");
  });
});
