# recovery 実装計画

## 設計判断

- L4の本人側2票は、L1じゅもん由来鍵と独立した第二要素鍵とし、鍵重複を禁止する。
- Sは256bitとし、送信しない。SからEd25519復旧証明鍵を導出し、challenge署名で所持を証明する。
- TimeDelayPolicyは`initiate_recovery`と`finalize_recovery`の二段階とする。pending作成トランザクションは成功させ、失敗時ロールバックでpendingが消える設計を避ける。
- 待機後に新しいThreshold認可を集める。Protocol 27 localnetはsmart-account-kitから直接RPC提出し、TestnetはAxum relay gatewayからOpenZeppelin Relayer + Channels Pluginへ転送する。
- Rule#Recoveryは完全一致するRule#0 signer replacementだけを許可するdeny-by-default設計とする。
- L2ペアリングはFR-RECOVERY-07/08通りQRコード（`qrcode`生成・`jsqr`+カメラ読取）を主導線とし、コピペのテキストコードは`<details>`内のフォールバックとして残す。
- 参加役（新端末）はまだパスキーを持たずログインできないため、ホスト役（既存端末、`DeviceManager`経由で`/app`配下）とは別に、ログイン不要の公開ルート`/device/join`（`DeviceJoin`、L3の`/guardian/join`と同じ形）に分離する。招待QRは招待コード文字列そのものではなく招待URL（`buildDeviceJoinUrl`で`/device/join?invite=<コード>`を生成）をエンコードし、新端末は標準カメラで読み取るだけで参加画面に招待コードが自動入力された状態で開ける。アプリ内カメラ読み取り・コード貼り付け（`extractInviteCode`でURL/生コードどちらも受理）はフォールバックとして残す。
- L2の端末ニックネーム（FR-RECOVERY-13）はオフチェーン・ブラウザローカル（localStorage、WebAuthn公開鍵をキーに保存）で管理する。on-chainには影響せず、他端末には同期しない前提とする。
- 既存端末は新端末からの応答をポーリングで自動検知し（手動の確認ボタンは廃止）、新端末はsigner追加が実際にon-chainで成功したかを`/api/pairing/sessions/{token}/complete`でポーリングして確認する。この結果は秘密材料を含まないため平文で中継する。
- 端末管理UIは「一覧」と「追加（ペアリング）」を`DeviceManager`1カードに統合し、`DevicePairingSetup`は`embedded`propでCard chromeを省略してその内側に描画する。追加完了で自動的に一覧へ戻る。
- Rule#0のうちWebAuthn passkey（`getCredentialIdFromSigner`で判定）だけを「端末」として一覧表示する。L1リカバリーフレーズ由来のEd25519鍵は端末ではないため一覧から除外する（既存のRecoveryPhraseSetupが担当領域）。
- 削除は即時実行せず一覧内でインライン確認（「外す」→「本当に外す」）を挟む。`kit.credentialId`と一致するsignerには「（この端末）」バッジを付け、確認時に「ここでログアウトされる」旨の警告文を追加する。
- 端末名は一覧から直接「名前を変更」でいつでも設定・変更できるようにする（ペアリング時にしか付けられない制約を撤廃）。ペアリングで参加する新端末自身も、相手に伝える呼び名を`saveDeviceNickname`で自分のlocalStorageにも保存し、自分の一覧で自分自身を無名表示しないようにする（同期はしない方針は維持）。

## コンポーネント

```text
TypeScript frontend (smart-account-kit)
  ├─ localnet: direct RPC ─────────────────────┐
  └─ Testnet: Axum relay gateway               │
              └─ OpenZeppelin Relayer          │
                 + Channels Plugin ────────────┤
                                               ▼
                              Smart Account + TimeDelayPolicy
```

Axum relay gatewayは`smart-account-kit`互換の`{func, auth}`/`{xdr}`を受け、wallet/function/WASM/auth root/resource fee/networkをallowlistで検証してからTestnetのChannels Pluginへ転送する。明示したSmart Account WASMのChannels-confirmed作成だけは、導出contract IDを永続化して固定の復旧管理関数に限定して追加許可する。OpenZeppelin Relayerがchannel account、fee bump、sequence、retry、statusを担当する。localnetではgateway/relayerを経由しない。

## 実装順

1. **smart-account-kit固定と基盤API適合性スパイク**
   - pnpm lockfileでSDK版を固定し、Protocol 27、account WASM、WebAuthn/Ed25519 verifier、threshold policyのlocalnet deploymentを固定する。
   - Policy trait、auth context、失敗時ロールバック、Rule#0経由認可の識別方法をlocalnetで確認する。
   - Rule#0認可を区別できなければ、cancel専用rule/entrypointを再設計する。
2. **暗号仕様の固定**
   - L1 wordlist、checksum、NFKD、HKDF、domain、Ed25519既知ベクトルを固定する。
   - L2はX25519 + HKDF-SHA-256 + ChaCha20-Poly1305、transcript/role/session/passkey binding、両端末確認、短命・単回tokenを固定する。
   - L4 challenge schemaとcommit既知ベクトルを固定する。
3. **TimeDelayPolicyクレート**
   - `install`、`initiate_recovery`、`finalize_recovery`、`cancel_recovery`、`get_pending`を実装する。
   - proposalにtarget contract/function、account、rule、old/new signer set、nonce、network、expiryを含める。
4. **TypeScriptフロント（L1/L2/L3）**
   - React/Viteとsmart-account-kitを導入し、Passkey、Ed25519 External Signer、複数署名をブラウザで実行する。
   - Vitestで暗号既知ベクトルを、PlaywrightでWebAuthnとオンチェーンE2Eを検証する。
   - 秘密非送信境界を実装する。
   - L3は`2 <= M <= N <= 5`、重複・address検証を全信頼境界へ実装する。
5. **L4 APIと4-eyes gate**
   - commit登録、challenge発行/消費、署名検証、承認者一意性、rate limit、ログredactionを実装する。
6. **Testnet relay経路**
   - Axum gatewayにSmart Account Kit互換endpoint、allowlist、rate limit、4-eyes gate、API key秘匿を実装する。
   - OpenZeppelin Relayer 1.5.xへChannels Pluginを導入し、Testnet fund/channel accountsを設定する。
   - `{func, auth}`と`{xdr}`、fee sponsor、retry、status pollingをTestnetで検証する。
7. **UI・統合テスト・監査準備**
   - 復旧開始、公開状態、cancel、待機後の再認可をlocalnet直接RPCとTestnet relayの両経路でend-to-endで検証する。

## 完了ゲート

- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`が成功する。
- `cargo test`、`cargo clippy -- -D warnings`、`cargo fmt --check`が成功する。
- S、じゅもん、秘密鍵がHTTP、DB、ログ、telemetryに現れない。
- initiate成功後にpendingが残り、期限前finalize失敗でも維持される。
- 開始時署名の再利用は失敗し、新しい2-of-3認可でのみfinalizeできる。
- operatorなしの独立した本人2鍵で成功し、同一鍵の重複登録は拒否される。
- localnet直接RPCとTestnet OpenZeppelin Relayer経路の双方でfinalizeでき、重複提出は一度だけ確定する。
- Rule#Recoveryによる許可対象外操作、改変、replay、別network利用が拒否される。

## 実装前に残る判断

プロダクト判断が必要なのは本番の待機時間。実装は設定可能な72時間で進める。外部依存APIの適合性スパイクで前提が崩れた場合のみ、実装を止めて設計確認を求める。
