import { expect, test } from "@playwright/test";

test("recovery phrase is displayed once and never sent to the API", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.postData() ?? "");
  });
  await page.goto("/");
  await page.getByRole("button", { name: "じゅもんを発行する" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(34);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "保管を終える" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(34);
  await expect(page.getByRole("alert")).toContainText("アカウントを開いてから");
  expect(apiRequests).toEqual([]);
});

test("account creation keeps direct-RPC recovery available while a fee sponsor is absent", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("新しいアカウントを作るための送信先が、まだ用意されていません。")).toBeVisible();
  await expect(page.getByRole("button", { name: "すでにあるアカウントを開く" })).toBeEnabled();
});
