import { randomBytes } from "node:crypto";

const baseUrl = "http://openzeppelin-relayer:8080";
const friendbotUrl = "http://stellar-localnet:8000/friendbot";
const sharedDeployer = "GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N";
const secretDir = "/run/account-sample-relayer";
const apiKey = (await import("node:fs/promises")).readFile(`${secretDir}/api-key`, "utf8").then((value) => value.trim());
const adminSecret = (await import("node:fs/promises")).readFile(`${secretDir}/admin-secret`, "utf8").then((value) => value.trim());

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${await apiKey}`,
      "content-type": "application/json",
      ...options.headers,
    },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

async function fundIfNeeded(address, label) {
  const funded = await fetch(friendbotUrl + "?addr=" + encodeURIComponent(address));
  if (funded.ok) return;
  const account = await fetch("http://stellar-localnet:8000/accounts/" + encodeURIComponent(address));
  if (!account.ok) throw new Error("failed to fund " + label + ": " + await funded.text());
}

async function ensureAccount(id, concurrentTransactions) {
  let current = await request("/api/v1/relayers/" + id);
  if (current.response.status === 404) {
    const signerId = id + "-signer";
    const signer = await request("/api/v1/signers", {
      method: "POST",
      body: JSON.stringify({ id: signerId, type: "plain", config: { key: randomBytes(32).toString("hex") } }),
    });
    if (!signer.response.ok && signer.response.status !== 409) {
      throw new Error("failed to create " + signerId + ": " + JSON.stringify(signer.body));
    }
    const relayer = await request("/api/v1/relayers", {
      method: "POST",
      body: JSON.stringify({
        id,
        name: "Account Sample " + id,
        network: "localnet",
        network_type: "stellar",
        paused: false,
        signer_id: signerId,
        notification_id: null,
        custom_rpc_urls: null,
        policies: {
          fee_payment_strategy: "relayer",
          ...(concurrentTransactions ? { concurrent_transactions: true } : {}),
        },
      }),
    });
    if (!relayer.response.ok && relayer.response.status !== 409) {
      throw new Error("failed to create " + id + ": " + JSON.stringify(relayer.body));
    }
    current = await request("/api/v1/relayers/" + id);
  }
  if (!current.response.ok) throw new Error("failed to read " + id + ": " + JSON.stringify(current.body));
  const address = current.body?.data?.address;
  if (typeof address !== "string" || !address.startsWith("G")) {
    throw new Error("relayer " + id + " did not expose a Stellar address");
  }
  await fundIfNeeded(address, id);
  for (let attempt = 0; attempt < 45; attempt += 1) {
    current = await request("/api/v1/relayers/" + id);
    if (current.response.ok && current.body?.data?.system_disabled !== true) return id;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("relayer " + id + " was not enabled after funding");
}

await fundIfNeeded(sharedDeployer, "smart-account-kit shared deployer");

const fund = await ensureAccount("channels-fund", true);
const channels = [
  await ensureAccount("channel-0001", false),
  await ensureAccount("channel-0002", false),
];

const management = await request("/api/v1/plugins/channels/call", {
  method: "POST",
  body: JSON.stringify({
    params: {
      management: {
        action: "setChannelAccounts",
        adminSecret: await adminSecret,
        relayerIds: channels,
      },
    },
  }),
});
if (!management.response.ok || management.body?.success !== true) {
  throw new Error(`failed to initialize Channels: ${JSON.stringify(management.body)}`);
}

console.log(`OpenZeppelin Channels ready: fund=${fund}, channels=${channels.join(",")}`);
