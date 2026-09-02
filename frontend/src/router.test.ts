import { describe, expect, it } from "vitest";
import { router } from "./router";

describe("router", () => {
  it.each([
    ["/login", "__root__ > /login"],
    ["/app", "__root__ > /_authenticated > /_authenticated/app"],
    ["/recovery", "__root__ > /recovery"],
    ["/recovery/phrase", "__root__ > /recovery/phrase"],
    ["/recovery/guardian", "__root__ > /recovery/guardian"],
    ["/guardian/join", "__root__ > /guardian/join"],
    ["/device/join", "__root__ > /device/join"],
  ])("resolves %s", async (path, expected) => {
    const matches = await router.matchRoutes(path, {}, { throwOnError: true });
    expect(matches.map((m) => m.routeId).join(" > ")).toBe(expected);
  });
});
