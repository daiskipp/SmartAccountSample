# デプロイ関連ドキュメント

環境ごとに1ファイル。

| ファイル | 対象 | 内容 |
| --- | --- | --- |
| [`localnet.md`](localnet.md) | ローカルの使い捨てchain | `just localnet-bootstrap` の中身、ローカル専用relayerの起動 |
| [`testnet.md`](testnet.md) | Stellar Testnet | コントラクト（Smart Account本体・検証者・`recovery-scope-policy`・`time-delay-policy`）のデプロイ手順、Testnet向けrelay gateway設定、現行デプロイの記録 |
| [`cloudflare.md`](cloudflare.md) | Cloudflare Workers / Pages | Axum APIのWorkers化デプロイとフロントのPagesデプロイ |

**依存関係**: `cloudflare.md` の手順は `testnet.md` でデプロイ済みのSmart Account
WASM hashとcontractアドレスを前提にする（`wrangler.toml`の`[vars]`とフロントの
`VITE_*`に反映するため）。新しいTestnet契約セットを用意しない限り、
`testnet.md` は再実行不要 — その場合は`cloudflare.md`だけで足りる。
