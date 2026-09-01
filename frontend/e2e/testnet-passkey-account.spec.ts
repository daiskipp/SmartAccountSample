import { expect, test } from "@playwright/test";

const enabled = process.env.RUN_TESTNET_E2E === "1";

test.describe("Testnet passkey account", () => {
  test.skip(!enabled, "set RUN_TESTNET_E2E=1 and server-only relay configuration to run against Testnet");

  test("creates a Smart Account through the Channels-backed relay", async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await page.goto("/");
    await page.getByLabel("呼ばれたい名前").fill(`Testnet E2E ${Date.now()}`);
    await page.getByRole("button", { name: "パスキーでアカウントを作る" }).click();
    await expect(page.getByText("アカウントを作成しました。", { exact: false })).toBeVisible({ timeout: 120_000 });
  });
});
