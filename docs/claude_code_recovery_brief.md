# 実装依頼：アカウントリカバリ機能（L0〜L4）

このドキュメントは Smart Account プロジェクトにおけるリカバリ機能（マルチデバイス・ソーシャルリカバリ・運営ガーディアン）の実装要件定義書です。Claude Code がこれを読んで実装してください。

添付のサンプル実装 `recovery-levels-demo.html` は、各レベルの暗号処理（鍵生成・ECDH・ハッシュ照合・タイムロック）を**単一HTMLファイル内で動作確認したプロトタイプ**であり、そのまま製品コードとして使うものではない。本番実装では smart-account-kit の実際のAPI（`kit.rules`, `kit.signers`, `kit.policies` 等）に置き換える。

---

## 1. 前提

### 1-1. プロジェクトの現状

Smart Account 基盤（OpenZeppelin Stellar Contracts、無改造）上に、EX/SBT/Coin/Avatar/Profile の各コントラクトが構築済み。認可モデルは smart-account-kit の **Context Rule × Signer × Policy** 三層モデルに準拠する（`SmartAccount_アカウント設計リファレンス.md` 参照）。

現状、Rule#0（Default）には主パスキー1つのみが登録されており、**リカバリ手段が一切存在しない**（L0状態）。

### 1-2. 本フェーズで追加するもの

段階別設計（`リカバリ設計_段階別まとめ.md` 参照）のうち、**L0〜L4を実装対象とする**。L5（ZK証明化）は将来フェーズとし、今回はスコープ外。

| レベル | 実装対象か | 概要 |
|---|---|---|
| L0 | 現状（変更なし） | 主パスキー単独 |
| L1 | **実装する** | バックアップEd25519鍵（ふっかつのじゅもん） |
| L2 | **実装する** | マルチデバイスペアリング（ECDH + SAS検証） |
| L3 | **実装する** | 友人ガーディアン（M-of-N、運営非関与） |
| L4 | **実装する** | 運営ガーディアン（所持証明型、個人情報ゼロ） |
| L5 | 対象外 | 将来フェーズ |

### 1-3. 重要な設計原則（既存＋本フェーズ追加分）

- Smart Account 基盤は無改造
- ノンカストディアル：秘密鍵材料はデバイス外に一度も出ない。運営はいかなる秘密（バックアップ鍵・じゅもん・S）も保持・受信しない
- L4における運営の関与は**Threshold(2)のうち1票のみ**とし、運営単独では一切の操作を実行できない構成を必須とする
- L4の運営票を除いても、残り2要素（本人の第二の秘密由来鍵＋ふっかつのじゅもん由来鍵）だけでThresholdが成立する構成を維持する（運営消滅時の可用性担保）
- ユーザー画面に技術用語を出さない（「Context Rule」「Threshold Policy」等は隠す）
- 設計→ドキュメント→実装の順序を維持する

---

## 2. 機能要件

### 2-1. L1：バックアップ鍵（ふっかつのじゅもん）

| FR | 内容 |
|---|---|
| FR-RECOVERY-01 | アカウント作成フロー内、またはオンボーディングの任意タイミングで「じゅもん発行」を提示する |
| FR-RECOVERY-02 | クライアント側で128bit以上のエントロピーを生成し、RPGテーマの単語列にエンコードして画面表示する |
| FR-RECOVERY-03 | 単語列からEd25519（またはP-256、既存External Signer実装に合わせる）鍵ペアを導出する |
| FR-RECOVERY-04 | 導出した公開鍵を Rule#0 の signer として追加する（既存のRule#0を維持したまま追加） |
| FR-RECOVERY-05 | 単語列は**一度だけ表示**し、確認後は画面・メモリから破棄する。再表示は不可 |
| FR-RECOVERY-06 | 単語列・秘密鍵はいかなる形でもサーバーに送信しない |

### 2-2. L2：マルチデバイスペアリング

| FR | 内容 |
|---|---|
| FR-RECOVERY-07 | 既存端末（接続済み）で「デバイスを追加」を選択すると、ペアリング用QRコード（またはワンタイムコード）を表示する |
| FR-RECOVERY-08 | 新端末でQR読み取り後、ローカルでECDH鍵ペアを生成し、既存端末とのECDHにより共有秘密を導出する |
| FR-RECOVERY-09 | 共有秘密から算出したSAS（短い確認コード、6桁程度）を両端末に表示し、ユーザーが目視で一致確認する |
| FR-RECOVERY-10 | SAS確認後、新端末でパスキー登録儀式を実行し、その公開鍵を既存端末側の署名で Rule#0 に追加する |
| FR-RECOVERY-11 | 中継サーバーは暗号化されたペイロードのみを中継し、鍵材料を復号できない（ゼロ知識中継） |
| FR-RECOVERY-12 | ペアリングトークンは短命（例：5分）かつ使い捨てとする |
| FR-RECOVERY-13 | 各signerに端末ニックネーム（例：「iPhone」「会社のMac」）を付与し、一覧・削除操作をしやすくする（オフチェーン管理で可） |
| FR-RECOVERY-14 | 端末紛失時、残存端末からのsigner削除（`kit.signers.remove`）操作を提供する |

### 2-3. L3：友人ガーディアン（自己主権ソーシャルリカバリ）

| FR | 内容 |
|---|---|
| FR-RECOVERY-15 | ユーザーが任意で「信頼できる人にお願いする」フローを選択できる |
| FR-RECOVERY-16 | ガーディアン候補を2〜5人程度、招待コード等で登録できる（各ガーディアンは自身のG-addressまたはExternal Signer公開鍵を持つ） |
| FR-RECOVERY-17 | 新規の Rule#Recovery（context_type = 独立ルール）を作成し、signers=ガーディアン集合、policies=[Threshold(M-of-N)] を設定する |
| FR-RECOVERY-18 | Rule#Recovery は Rule#0 の signer 入れ替え権限のみを持ち、日常操作（送金・アイテム操作等）の権限は一切持たない |
| FR-RECOVERY-19 | ガーディアンのThreshold(M)が signers 数(N)と整合すること（M ≦ N、M ≧ 2 を推奨）をクライアント側でバリデーションする |
| FR-RECOVERY-20 | リカバリ実行画面（ガーディアン向け）で承認状況を確認でき、Threshold成立時にRule#0のsigner差し替えトランザクションを構築・提出できる |

### 2-4. L4：運営ガーディアン（所持証明型）

| FR | 内容 |
|---|---|
| FR-RECOVERY-21 | ユーザーが任意で「運営のサポートを頼る」を選択できる（L3とは別の選択肢として提示、併用も可） |
| FR-RECOVERY-22 | クライアント側で高エントロピーな秘密 S を生成し、`commit = hash(S \|\| contractId)` を計算する |
| FR-RECOVERY-23 | commit のみをサーバーに送信・保存する。S自体は一度もサーバーに送信しない |
| FR-RECOVERY-24 | S はユーザーに一度だけ表示し、オフライン保管を促す（L1のじゅもんとは独立した別の秘密として扱う） |
| FR-RECOVERY-25 | Rule#Recovery に運営のG-address（Delegated Signer）を追加し、Threshold(2)・3signer構成（運営・本人第二要素・ふっかつのじゅもん由来鍵）とする |
| FR-RECOVERY-26 | 依頼受付フローで、依頼者が S を提示 → サーバーが `hash(S \|\| contractId)` を計算し、保存済み commit と照合する |
| FR-RECOVERY-27 | 照合一致後、運営内部の2名承認（4-eyes原則）を経て、運営鍵の署名をオンチェーンに提出する |
| FR-RECOVERY-28 | 運営署名提出後、カスタムTimeDelay Policyにより pending 状態へ遷移し、72時間（設定可能）の待機期間を設ける |
| FR-RECOVERY-29 | 待機期間中、本人の既存Rule#0 signerによる `cancel_recovery()` 相当の呼び出しでpending状態を破棄できる |
| FR-RECOVERY-30 | 待機期間中、認証不要の公開ステータス確認ページ（`contractId` ベース）で進行中リカバリの有無・残り時間を確認できる（プル型通知） |
| FR-RECOVERY-31 | 待機期間満了かつキャンセルがなければ、Threshold(2)の残り1票（本人第二要素 or じゅもん由来鍵）と合わせてRule#0のsigner差し替えを確定する |

---

## 3. 非機能要件

| NFR | 内容 |
|---|---|
| NFR-RECOVERY-01 | 秘密鍵・じゅもん・S はいかなる経路でもサーバーに平文送信されない |
| NFR-RECOVERY-02 | L4の運営鍵は3signer構成のうち1つに留め、運営票を除いた残り2要素だけでThreshold(2)が成立する構成を維持する |
| NFR-RECOVERY-03 | ペアリング中継サーバーは暗号化ペイロードのみを扱い、鍵材料を復号できない |
| NFR-RECOVERY-04 | 依頼受付APIにレート制限を設け、同一アカウントへの短時間repeated申請を防ぐ |
| NFR-RECOVERY-05 | L4の社内承認は必ず2名以上（4-eyes原則）とし、単一担当者の判断だけでは運営鍵の署名が実行されない |
| NFR-RECOVERY-06 | Rule#Recoveryは日常操作の権限を一切持たない（Rule#0のsigner入れ替えのみ許可） |
| NFR-RECOVERY-07 | カスタムTimeDelay Policyは外部監査の対象とする（既存の標準policyとは異なり監査済みでないため） |

---

## 4. コントラクト仕様

### 4-1. Rule#Recovery（L3/L4共通の枠組み）

既存のContext Ruleの仕組みをそのまま利用する。新規のコントラクト実装は不要（`kit.rules.add()` で作成可能）。

| 要素 | L3構成 | L4構成 |
|---|---|---|
| context_type | 独立Rule（Rule#0のsigner変更のみ許可） | 同左 |
| signers | ガーディアンG1〜Gn | 運営G-address、本人第二要素、じゅもん由来鍵 |
| policies | Threshold(M-of-N) | Threshold(2) + TimeDelay(カスタム) |
| valid_until | なし（恒常） | なし（恒常。Policy側で都度pending判定） |

### 4-2. TimeDelayPolicy（新規カスタムPolicyコントラクト）

OpenZeppelinの `Policy` trait を実装する新規コントラクト。標準policyには存在しないため新規実装が必要。

#### 状態

```
#[contracttype]
pub struct PendingRecovery {
    pub initiated_at_ledger: u32,
    pub valid_from_ledger: u32,   // initiated_at + delay_period
    pub cancelled: bool,
}

// ストレージ
pending_recoveries: Map<(Address /* smart_account */, u32 /* context_rule_id */), PendingRecovery>
```

#### 関数

| 関数 | 引数 | 認可 | 内容 |
|---|---|---|---|
| `install(wallet)` | Address | 追加時のフック | 初期化のみ、pendingは作らない |
| `enforce(auth_context)` | 標準Policy interface | Threshold Policyと直列で評価 | Threshold(2)を満たした時点でpendingが無ければ作成し、`valid_from_ledger` 経過前なら認可を拒否（=まだ発火しない）。経過後は認可を許可 |
| `cancel_recovery(account, context_rule_id)` | Address, u32 | **account本人のRule#0 signerによるrequire_auth** | pendingを削除し、初期状態に戻す |
| `get_pending(account, context_rule_id)` | Address, u32 | 公開 | PendingRecoveryを返す（公開ステータスページ用） |

#### 状態遷移

```
[平常時: pending無し]
      │ Threshold(2)を満たす署名が集まる（enforce呼び出し）
      ▼
[pending作成: valid_from_ledger = 現在 + delay_period]
      │ enforceは認可を拒否し続ける（まだ実行不可）
      │
      ├─ 本人がcancel_recovery()を呼ぶ ──→ [pending削除、平常時に戻る]
      │
      └─ valid_from_ledger 経過 ──→ 以降のenforce呼び出しで認可を許可
```

**注意**：README記載の「Threshold/Weighted Thresholdはsigner集合の変更を自動検知しない」という既知の制約と同様、TimeDelayPolicyもRule#Recoveryのsigner構成が変更された際にpending状態との整合性が壊れないよう、`install`/signer変更時のガードを検討すること。

### 4-3. ProfileContract / IssuerContractへの影響

既存のProfileContract・IssuerContractには変更不要。リカバリ機能はSmart Account自体のContext Rule/Signer/Policy層で完結する。

---

## 5. フロントエンド仕様

### 5-1. オンボーディングフロー（新規アカウント作成後）

```
アカウント作成完了
      ↓
「もしものときの備えを設定しましょう」画面
      ↓
ステップ1（強く推奨）：じゅもん発行 → L1
      ↓
ステップ2（任意）：「もう1台の端末も使いますか？」→ Yesならペアリング → L2
      ↓
ステップ3（任意・選択式）：
  a) 信頼できる友人にお願いする → L3
  b) 運営のサポートを頼る（個人情報は預けません） → L4
  c) 今は設定しない
      ↓
ステータス画面へ
```

### 5-2. 新規画面

| 画面 | 内容 |
|---|---|
| じゅもん発行画面 | 単語列を一度だけ表示、確認チェック後に破棄 |
| デバイス追加画面（既存端末側） | QRコード表示、SAS確認、承認操作 |
| デバイス追加画面（新端末側） | QR読み取り、SAS確認、パスキー登録 |
| デバイス一覧画面 | signer一覧（ニックネーム付き）、削除操作 |
| ガーディアン設定画面（L3） | ガーディアン招待・一覧、Threshold設定 |
| 運営ガーディアン設定画面（L4） | 秘密S発行、一度だけ表示 |
| リカバリ依頼画面（利用者向け） | S入力、進行状況表示、公開ステータスページへのリンク |
| 公開ステータスページ | 認証不要、`contractId` ベースでpending有無・残り時間を表示 |

### 5-3. UI言語register

既存の方針（ログイン画面は機能的な用語、ステータス画面は柔らかいRPG風日本語）を踏襲する。リカバリ関連画面は「もしものとき」「たすけをよぶ」等、不安を煽らない柔らかい表現を用いる。

---

## 6. データの流れ（L4の例）

```
[事前登録]
ユーザー: 秘密S生成（クライアントのみ）
      ↓
クライアント: commit = hash(S || contractId)
      ↓
運営サーバー: commitのみ保存（Sは受信しない）

[依頼〜実行]
ユーザー: S を依頼フォームに入力
      ↓
運営サーバー: hash(S || contractId) を計算し、保存済みcommitと照合
      ↓ 一致
運営: 社内2名承認（4-eyes）
      ↓
運営: Delegated Signerとして Rule#Recovery への署名をオンチェーン提出
      ↓
TimeDelayPolicy: pending状態に遷移、valid_from_ledgerを記録
      ↓
[72時間待機]
本人: 公開ステータスページ or 既存パスキーでの検知により気づく
      │
      ├─ 異議あり → cancel_recovery() 呼び出し → 中断
      │
      └─ 異議なし・経過 → 残り1票（本人第二要素 or じゅもん）が確認され、
                            Rule#0のsigner差し替えが確定
```

---

## 7. テスト要件

### 7-1. TimeDelayPolicy単体テスト

| テスト | 期待結果 |
|---|---|
| Threshold(2)未達で `enforce` 呼び出し | 認可拒否、pendingは作られない |
| Threshold(2)達成、delay_period未経過 | 認可拒否、pending作成済み |
| Threshold(2)達成、delay_period経過後 | 認可許可 |
| pending中に本人以外が `cancel_recovery` を呼ぶ | Unauthorized相当のエラー |
| pending中に本人が `cancel_recovery` を呼ぶ | pending削除、以後は平常時と同じ挙動に戻る |
| pending解消後、再度Threshold(2)を満たす | 新しいpendingが作成される（前回の状態を引きずらない） |

### 7-2. 統合テスト

| テスト | 期待結果 |
|---|---|
| L1：じゅもん発行 → Rule#0への追加 → 主パスキー喪失を模擬 → じゅもん由来鍵でログイン | 成功 |
| L2：ペアリング完了 → 新端末からの接続 | 成功、SAS不一致時は追加を拒否できる |
| L3：ガーディアン3人中2人承認 → signer差し替え | 成功。1人のみの承認では実行不可であることを確認 |
| L4：正しいSでの照合 → 72h待機 → キャンセルなし → 確定 | 成功 |
| L4：誤ったSでの照合 | 却下、pendingは作られない |
| L4：待機中に本人がキャンセル | pending破棄、Rule#0は変更されない |
| L4：運営票を除いた2要素のみでのThreshold(2)成立確認 | 運営が関与しなくても復旧が成立することを確認 |

---

## 8. 受け入れ基準

| AC | 内容 |
|---|---|
| AC-RECOVERY-01 | じゅもん発行後、単語列はアプリ内のどこにも再表示されない |
| AC-RECOVERY-02 | 秘密鍵・じゅもん・Sのいずれも、ネットワーク経由でサーバーに送信されないことをネットワークログで確認できる |
| AC-RECOVERY-03 | L4で運営がcommit以外の情報を保持しないことをサーバー側ストレージ確認で検証できる |
| AC-RECOVERY-04 | Rule#Recoveryが日常操作（送金・アイテム操作）に使用できないことを確認する |
| AC-RECOVERY-05 | L4のTimeDelayPolicyについて外部監査見積もりが取得されている |
| AC-RECOVERY-06 | 運営票を除いた2要素のみでL4のリカバリが成立することを確認する |
| AC-RECOVERY-07 | 公開ステータスページが認証なしで閲覧できる |
| AC-RECOVERY-08 | 既存のEX/SBT/Coin/Avatar機能に影響がない（リグレッションテスト） |

---

## 9. 非ゴール（本フェーズで実装しないこと）

| 項目 | 理由 |
|---|---|
| L5（ZK証明化） | 将来フェーズ。commit-reveal・ZK回路の実装は別途検討 |
| 生体照合による追加確認 | 個人情報最小化方針のため、初期リリースでは扱わない |
| 運営承認の完全自動化 | 4-eyes原則を維持するため、人的承認ステップを残す |
| L3ガーディアンの招待UXの高度化（プッシュ通知連携等） | 最小限の招待コード共有で足りるとし、UX強化は次フェーズ |

---

## 10. 添付・関連リソース

- `recovery-levels-demo.html`：L0〜L5の暗号処理を単一HTMLで動作確認したプロトタイプ。ECDSA/ECDH鍵生成・SHA-256照合・タイムロック状態遷移の**参考実装**として使用可（製品コードへの直接転用は不可、smart-account-kitの実際のAPIに置き換えること）
- `SmartAccount_アカウント設計リファレンス.md`：三層モデルの設計原則
- `smart-account-design-reference.html`：同内容の図解版
- `リカバリ設計_段階別まとめ.md`：L0〜L5の全体設計
- `運営ガーディアンリカバリ_実現可能性検証.md`：L4の実現可能性精査（タイムロックPolicyが唯一の新規実装要素である旨の結論を含む）
- smart-account-kit README：`kit.rules`, `kit.signers`, `kit.policies` のAPI仕様
- OpenZeppelin stellar-contracts：Policy traitの実装パターン

---

## 11. 実装の進め方（推奨）

1. **TimeDelayPolicyコントラクトの単体実装とテスト**（最も新規性が高く、監査対象となる部分を先に固める）
2. **L1（じゅもん発行）のフロント実装**：既存のExternal Signer追加フローの応用のため、比較的着手しやすい
3. **L2（ペアリング）のフロントとリレーサービス実装**
4. **L3（ガーディアン）のフロント実装**：Rule#Recovery作成・Threshold設定は既存smart-account-kit APIの組み合わせで完結
5. **L4（運営ガーディアン）のバックエンド（commit保存・照合API・社内承認フロー）実装**
6. **L4のフロント（S発行・依頼画面・公開ステータスページ）実装**
7. **統合テスト・リグレッションテスト**

---

## 12. 質問・確認事項

実装中に不明点があれば、以下を確認してください：

1. **delay_periodの具体値**：本文中は72hとしているが、実運用値はプロダクト判断で確定すること
2. **本人第二要素の具体的な生成方法**：L4の3signer構成における「本人の第二要素」は、L1のじゅもんとは独立した別の鍵として用意するか、あるいはL1のじゅもんを流用するかは設計判断が必要（本ドキュメントでは独立を推奨しているが、ユーザー体験上の負担とのトレードオフがある）
3. **社内承認フローの実装範囲**：4-eyes原則を満たす具体的な運用ツール（承認用管理画面等）は本ドキュメントのスコープ外。別途運営オペレーション側の要件定義が必要
4. **法的確認**：運営がThresholdの1票を持つ設計について、実装着手前に該当法域の弁護士へ確認すること
