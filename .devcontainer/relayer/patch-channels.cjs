const fs = require("node:fs");

const path = "node_modules/@openzeppelin/relayer-plugin-channels/dist/plugin/config.js";
let source = fs.readFileSync(path, "utf8");

const networkCheck = "networkRaw !== 'testnet' && networkRaw !== 'mainnet'";
if (!source.includes(networkCheck)) throw new Error("Channels network validation changed upstream");
source = source.replace(networkCheck, "networkRaw !== 'testnet' && networkRaw !== 'mainnet' && networkRaw !== 'localnet'");
source = source.replace(
  "STELLAR_NETWORK must be \"testnet\" or \"mainnet\"",
  "STELLAR_NETWORK must be \"testnet\", \"mainnet\", or \"localnet\"",
);

const passphrase = "return network === 'mainnet' ? stellar_sdk_1.Networks.PUBLIC : stellar_sdk_1.Networks.TESTNET;";
if (!source.includes(passphrase)) throw new Error("Channels passphrase selection changed upstream");
source = source.replace(
  passphrase,
  "return network === 'localnet' ? requireEnv('STELLAR_NETWORK_PASSPHRASE') : (network === 'mainnet' ? stellar_sdk_1.Networks.PUBLIC : stellar_sdk_1.Networks.TESTNET);",
);

fs.writeFileSync(path, source);
