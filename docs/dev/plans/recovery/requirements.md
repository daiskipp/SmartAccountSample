# recovery 要件定義書

## 概要

Smart Account（OpenZeppelin Stellar Contracts、無改造）に、Context Rule × Signer × Policy
の三層認可モデルを用いてアカウントリカバリ機能 L1〜L4 を追加する。現状は L0（主パスキー1つのみ、
リカバリ手段なし）。L5（ZK証明化）は将来フェーズとしてスコープ外。

対象レイヤーはフロントエンド（TypeScript/React UI）・Axum API（ペアリング中継/commit保存）・オンチェーン
（Soroban/TimeDelayPolicy）の全レイヤー。出典は `docs/claude_code_recovery_brief.md`（実装依頼書）
全文と、ユーザーへの3ラウンドのヒアリングでの決定事項。

## 関連文書

- **ユーザーストーリー**: [user-stories.md](user-stories.md)
- **受入基準**: [acceptance-criteria.md](acceptance-criteria.md)
- **設計・タスク**: [plan.md](plan.md)

## 用語集

| 用語 | 定義 |
|-----|------|
| ふっかつのじゅもん | L1のバックアップ鍵を導出するための、クライアント側で生成されるRPGテーマの単語列（128bit以上のエントロピー） |
| Rule#0 | 既存の主パスキーを含む、日常操作を許可する既存のContext Rule |
| Rule#Recovery | L3/L4で新設する、Rule#0のsigner入れ替えのみを許可する独立したContext Rule |
| SAS (Short Authentication String) | L2ペアリングでECDH共有秘密から導出する6桁程度の照合コード |
| commit | L4で `SHA-256(domain \|\| proof_public_key \|\| contractId)` として計算され、サーバーに保存される値 |
| S | L4で本人がオフライン保管する256bit秘密。送信せず、Sから導出した署名鍵で所持を証明する |
| recovery proof key | SとcontractIdからHKDF-SHA-256で導出するEd25519鍵。秘密鍵はクライアント外へ出さない |
| 4-eyes（4アイズ） | 運営内部で2名以上の承認が揃わないと運営鍵の署名を実行できない社内統制原則 |
| TimeDelayPolicy | L4で新規実装するカスタムPolicyコントラクト。Threshold(2)充足後、待機期間（デフォルト72h）が経過するまで認可を拒否する |
| Delegated Signer | 運営が保持するG-address由来のsigner。L4のRule#Recoveryに1票のみ持つ |
| G-address | Smart Account基盤における、外部主体（ガーディアン/運営）を表すアドレス形式のsigner識別子 |

**brief番号との対応**: 本書のFR-1xx〜4xxは、`docs/claude_code_recovery_brief.md` の FR-RECOVERY-01〜31
を EARS 5分類に再構成したもの。1対1対応ではなく、複数のFR-RECOVERY-XXを1つのFR-XXXに統合、または
1つのFR-RECOVERY-XXを複数のFR-XXXに分割している箇所がある。§12の4つのオープン課題は CON-008〜CON-011
に対応する。

## 機能要件（EARS記法）

**【信頼性レベル凡例】**:
- 🔵 PRD・設計文書・ヒアリングに基づく確実な要件
- 🟡 妥当な推測による要件
- 🔴 AI推論補完による要件（要確認）

### 普遍要件（SHALL）

- **FR-001**: システムはSmart Account基盤（既存Context Rule/Signer/Policyの仕組み）を無改造で利用しなければならない 🔵 *[brief 前提/CLAUDE.md]*
  - 関連: US-001, US-201, US-301, AC-001, AC-007, AC-009
- **FR-002**: システムは秘密鍵材料・じゅもん・L4の秘密Sをデバイス外へ送信できる経路を一切持たない設計としなければならない 🔵 *[brief 不変条件/§8 AC-RECOVERY-02]*
  - 関連: US-001, US-301, AC-022
- **FR-003**: システムはL4のThreshold(2)構成において運営を3signer中1票のみとし、運営票を除く残り2signerのみでThreshold(2)が成立する構成を維持しなければならない 🔵 *[brief §4-1/§8 AC-RECOVERY-06]*
  - 関連: US-305, AC-021
- **FR-004**: システムはステータス系・リカバリ系のユーザー向け画面で「Context Rule」「Threshold Policy」等の実装用語を表示せず、RPG風の柔らかい日本語（例:「もしものとき」「たすけをよぶ」）で表現しなければならない 🔵 *[brief §5-3]*
  - 関連: US-402, AC-020
- **FR-005**: システムは各signerに識別用のニックネームを付与し、一覧表示・削除操作を提供しなければならない 🔵 *[brief §2 L2要件]*
  - 関連: US-104, AC-006

### イベント駆動要件（WHEN-THEN） — L1: バックアップ鍵

- **FR-101**: オンボーディング中にユーザーが「じゅもん発行」を選択した場合、システムはクライアント側で128bit以上のエントロピーを生成し、RPGテーマの単語列にエンコードして表示しなければならない 🔵 *[brief §2 L1]*
  - 関連: US-001, AC-001
- **FR-102**: じゅもんが生成された場合、システムはクライアント側で固定wordlist・checksum・Unicode NFKD正規化・バージョン付きdomain separationを用い、HKDF-SHA-256からEd25519鍵ペアを決定論的に導出し、既知ベクトルで仕様を固定しなければならない 🔵 *[brief §2 L1]*
  - 関連: US-001, AC-001
- **FR-103**: じゅもん由来の鍵ペアが導出された場合、システムはその公開鍵をRule#0のsignerとして追加し、既存Rule#0のsignerは維持しなければならない 🔵 *[brief §2 L1]*
  - 関連: US-001, US-002, AC-001, AC-002
- **FR-104**: ユーザーがじゅもんの確認チェックを完了した場合、システムは単語列を画面表示・メモリの両方から破棄し、以降再表示してはならない 🔵 *[brief §2 L1/§8 AC-RECOVERY-01]*
  - 関連: US-001, AC-001

### イベント駆動要件（WHEN-THEN） — L2: マルチデバイスペアリング

- **FR-111**: 既存端末でユーザーが「デバイスを追加」を選択した場合、システムはペアリング用のQRコードまたはワンタイムコードを表示しなければならない 🔵 *[brief §2 L2]*
  - 関連: US-101, AC-003
- **FR-112**: 新端末がQRコードを読み取った場合、システムは新端末上でローカルにECDH鍵ペアを生成し、共有秘密を導出しなければならない 🔵 *[brief §2 L2]*
  - 関連: US-102, AC-003
- **FR-113**: 共有秘密が導出された場合、システムはその共有秘密から6桁程度のSASを両端末に表示しなければならない 🔵 *[brief §2 L2]*
  - 関連: US-102, US-103, AC-003, AC-004
- **FR-114**: 両端末でユーザーがSAS一致を確認した場合、システムは新端末でパスキー登録を行い、その公開鍵を既存端末側の署名でRule#0に追加しなければならない 🔵 *[brief §2 L2]*
  - 関連: US-101, US-102, US-103, AC-003
- **FR-115**: SASが一致しない、またはユーザーが不一致と申告した場合、システムはペアリング（新規signer追加）をブロックしなければならない 🔵 *[brief §7 統合テスト]*
  - 関連: US-103, AC-004
- **FR-116**: ペアリングトークンが発行された場合、システムはそれを短命（5分程度、実装時に仮決定）かつ使い捨てとして扱わなければならない 🟡 *[brief §2 L2/NFR §12決定1類似の定数仮置き方針]*
  - 関連: US-101, AC-005
- **FR-117**: signerが追加された場合、システムはその端末にニックネームを付与し、一覧表示・削除操作を提供しなければならない 🔵 *[brief §2 L2]*
  - 関連: US-104, AC-006
- **FR-118**: ユーザーが端末紛失を申告し残存端末から削除操作を行った場合、システムは`kit.signers.remove`相当の操作で対象signerをRule#0から削除しなければならない 🔵 *[brief §2 L2]*
  - 関連: US-104, AC-006

### イベント駆動要件（WHEN-THEN） — L3: 友人ガーディアン

- **FR-121**: ユーザーが「信頼できる人にお願いする」を選択した場合、システムはガーディアン候補（2〜5人）を招待コード等で登録するフローを提供しなければならない 🔵 *[brief §2 L3]*
  - 関連: US-201, AC-007
- **FR-122**: ガーディアン登録が完了した場合、システムは新規独立Rule#Recoveryを作成し、signers=登録済みガーディアン集合、policies=Threshold(M-of-N)を設定しなければならない 🔵 *[brief §2 L3/§4]*
  - 関連: US-201, AC-007
- **FR-123**: ユーザーがThreshold値(M)を設定する場合、システムはクライアント、ドメインおよびオンチェーン境界の各層で`2 <= M <= N <= 5`、guardian重複なし、有効addressであることを検証しなければならない 🔵 *[brief §2 L3]*
  - 関連: US-201, AC-007
- **FR-124**: ガーディアンがリカバリ実行画面を開いた場合、システムは承認状況（何人が承認済みか）を表示しなければならない 🔵 *[brief §2 L3]*
  - 関連: US-202, AC-008
- **FR-125**: ガーディアンの承認がThreshold(M-of-N)に到達した場合、システムはRule#0のsigner差し替えトランザクションを構築・提出しなければならない 🔵 *[brief §2 L3]*
  - 関連: US-203, AC-008
- **FR-126**: ガーディアンの承認がThreshold(M-of-N)に到達していない場合、システムはRule#0のsigner差し替えを実行してはならない 🔵 *[brief §7 統合テスト（1-of-3失敗）]*
  - 関連: US-203, AC-008

### イベント駆動要件（WHEN-THEN） — L4: 運営ガーディアン

- **FR-131**: ユーザーが「運営のサポートを頼る」を選択した場合、システムはL3とは独立した選択肢として（併用可能な形で）L4設定フローを提供しなければならない 🔵 *[brief §2 L4/§5-1]*
  - 関連: US-301, AC-009
- **FR-132**: L4設定フローが開始された場合、システムはクライアント側で256bitのSを生成し、HKDF-SHA-256（salt=`contractId`、info=`account-sample/l4-proof/v1`）でEd25519復旧証明鍵を導出し、`commit = SHA-256("account-sample/l4-commit/v1" || proof_public_key || contractId)`を計算しなければならない 🔵 *[brief §2 L4/§6]*
  - 関連: US-301, AC-009
- **FR-133**: commitが計算された場合、システムはcommitのみをサーバーへ送信・保存し、S自体は一度もサーバーへ送信してはならない 🔵 *[brief §2 L4/§8 AC-RECOVERY-03]*
  - 関連: US-301, AC-009, AC-010
- **FR-134**: commit送信が完了した場合、システムはSをユーザーに一度だけ表示し、オフライン保管を促さなければならない 🔵 *[brief §2 L4]*
  - 関連: US-301, AC-009
- **FR-135**: L4設定が完了した場合、システムはRule#Recoveryに運営G-address（Delegated Signer）を追加し、Threshold(2)・3signer構成（運営・本人第二要素・じゅもん由来鍵）を設定しなければならない 🔵 *[brief §4]*
  - 関連: US-301, AC-009
- **FR-136**: ユーザーがL4リカバリを依頼する場合、サーバーは単回使用・短命でaccount/contract/networkに束縛したchallengeを発行し、クライアントはSから復旧証明鍵を再導出して署名しなければならない。サーバーは提示公開鍵からcommitを再計算して保存値と定数時間比較し、署名・束縛・期限・未使用性を検証する。Sを要求・受信してはならない 🔵 *[brief §2 L4/§6]*
  - 関連: US-302, AC-011
- **FR-137**: S照合が一致した場合、システムは運営内部2名以上の承認（4-eyes）が完了するまで、運営鍵によるオンチェーン署名提出を許可してはならない 🔵 *[brief §2 L4/§4]*
  - 関連: US-302, AC-012
- **FR-138**: S照合が一致せず4-eyes承認済みでない場合、システムはリカバリ依頼を拒否し、pending状態を作成してはならない 🔵 *[brief §7 統合テスト]*
  - 関連: US-302, AC-011
- **FR-139**: 4-eyes承認後、必要な認可を伴う`initiate_recovery`が成功した場合、TimeDelayPolicyはpendingを永続化して待機期間を設定しなければならない。このトランザクションは意図的な失敗を返してはならない 🔵 *[brief §4-2/§12決定1]*
  - 関連: US-305, AC-015, AC-016
- **FR-140**: 待機期間中にユーザーが既存Rule#0 signerで`cancel_recovery()`を呼び出した場合、システムはpendingを破棄し、Rule#0を変更せず初期状態に戻さなければならない 🔵 *[brief §4-2/§6]*
  - 関連: US-303, AC-017, AC-018
- **FR-141**: 待機期間満了後、新たに収集したThreshold(2)認可を伴う`finalize_recovery`を提出し、pendingに束縛されたaccount、rule、提案signer集合、nonce、network、期限を検証してRule#0 signer差し替えを確定しなければならない。開始時の署名を再利用してはならない 🔵 *[brief §4-2/§6]*
  - 関連: US-305, AC-016, AC-021

### イベント駆動要件（WHEN-THEN） — TimeDelayPolicyコントラクト

- **FR-151**: Rule#RecoveryにTimeDelayPolicyが追加された場合、`install(wallet)`は初期化のみを行い、pendingレコードを作成してはならない 🔵 *[brief §4-2]*
  - 関連: US-305, AC-013
- **FR-152**: `initiate_recovery(auth_context, proposal_hash)`がThresholdを満たしpendingがない場合、pending、現在ledger基準の`valid_from_ledger`、一意nonce、不変のproposal_hashを保存して正常終了しなければならない 🔵 *[brief §4-2]*
  - 関連: US-305, AC-014, AC-015
- **FR-153**: `finalize_recovery(auth_context, proposal)`が期限前に呼ばれた場合、拒否して既存pendingを変更してはならない 🔵 *[brief §4-2]*
  - 関連: US-305, AC-015
- **FR-154**: `finalize_recovery`が期限後に呼ばれ、新しいThreshold認可とproposal_hashが一致する場合のみ差し替えを許可し、成功後pendingを消費しなければならない 🔵 *[brief §4-2]*
  - 関連: US-305, AC-016
- **FR-155**: `cancel_recovery(account, context_rule_id)`が呼び出された場合、システムは専用auth contextによりRule#0経由の認可であることを検証しなければならない。単なるaccount addressの`require_auth`だけに依存してはならない 🔵 *[brief §4-2]*
  - 関連: US-303, AC-017
- **FR-156**: `get_pending(account, context_rule_id)`が呼び出された場合、システムは認証なしでPendingRecoveryの状態を返さなければならない 🔵 *[brief §4-2/§5]*
  - 関連: US-304, AC-020

### 状態駆動要件（WHERE）

- **FR-201**: pendingが存在する間、システムは`finalize_recovery()`に対し時刻、nonce、proposal_hash、認可期限、network IDおよびreplay済みでないことを検証しなければならない 🔵 *[brief §4-2]*
  - 関連: US-305, AC-014, AC-015, AC-016
- **FR-202**: リカバリ待機期間中、システムは公開ステータスページ上で残り時間とpendingの有無を表示し続けなければならない 🔵 *[brief §5]*
  - 関連: US-304, AC-020

### 任意要件（MAY）

- **FR-301**: システムはL3とL4の併用を許可してもよい 🔵 *[brief §5-1: L3/L4は併用可]*
  - 関連: US-401
- **FR-302**: システムはオンボーディングのステップ3で「今は設定しない」を選び、L3/L4設定をスキップしてステータス画面へ遷移する経路を提供してもよい 🔵 *[brief §5-1]*
  - 関連: US-401
- **FR-303**: システムはdelay_periodを設定可能な値として実装し、将来デフォルト値（72h）を変更できる構成としてもよい 🔵 *[brief §12決定1]*
  - 関連: US-305

### 禁止要件（MUST NOT）

- **FR-401**: システムはS・じゅもん・秘密鍵をいかなる経路でもサーバーへ送信してはならない。L4所持証明では公開鍵、challenge、署名だけを送信しなければならない 🔵 *[brief §8 AC-RECOVERY-02]*
  - 関連: AC-022
- **FR-402**: システムはL4サーバー側ストレージにcommit以外（S自体を含む）を保存してはならない 🔵 *[brief §8 AC-RECOVERY-03]*
  - 関連: AC-010
- **FR-403**: システムはRule#Recoveryを日常操作（送金・アイテム操作等）の認可に使用してはならない 🔵 *[brief 不変条件/§8 AC-RECOVERY-04]*
  - 関連: AC-023
- **FR-404**: L2ペアリング中継サーバーは中継する暗号化ペイロードを復号してはならない（ゼロ知識中継） 🔵 *[brief §2 L2]*
  - 関連: AC-003
- **FR-405**: システムは単一の内部承認者のみで運営鍵の署名を実行させてはならない（4-eyes必須） 🔵 *[brief §2 L4/§4]*
  - 関連: AC-012
- **FR-406**: システムはじゅもんの単語列を発行後に再表示してはならない 🔵 *[brief §8 AC-RECOVERY-01]*
  - 関連: AC-001
- **FR-407**: Rule#Recoveryは許可リスト化したRule#0 signer replacementだけを認可し、呼び出し先、関数、account、rule ID、置換前後signer集合、nonce、期限、network IDを署名対象に束縛する。それ以外は未知の操作も含め全拒否する 🔵
- **FR-408**: `cancel_recovery`はRule#0経由の認可を証明できる専用auth contextを検証する。基盤APIで区別不能なら実装を止め、専用cancel ruleまたは入口を設計する 🔵

## 非機能要件

### パフォーマンス

- **NFR-001**: レート制限やペアリングトークン有効期限は、個人プロトタイプ規模のため厳密な数値目標を設けず、実装時に仮置き定数（例: レート制限=1分間N回、ペアリングトークン有効期限=5分）として設定し、後から調整可能な設計としてよい 🔵 *[§12類似のユーザー決定/ヒアリング明記]*

### セキュリティ

- **NFR-101**: L2ペアリング中継サーバーは暗号化ペイロードのみを扱い、鍵材料を復号できてはならない 🔵 *[brief §3]*
- **NFR-102**: リカバリ依頼受付APIは、同一アカウントへの短時間の繰り返し申請を防ぐレート制限を備えなければならない 🔵 *[brief §3]*
- **NFR-103**: L4運営鍵の署名実行は必ず2名以上の内部承認（4-eyes）を経なければ実行できてはならない 🔵 *[brief §3/§4]*
- **NFR-104**: カスタムTimeDelayPolicyコントラクトは標準Policyと異なり未監査であるため、外部監査の対象としなければならない 🔵 *[brief §3/§8 AC-RECOVERY-05]*

### ユーザビリティ

- **NFR-201**: ステータス系・リカバリ系画面はRPG風の柔らかい日本語表現を用い、不安を煽らないコピーとしなければならない（ログイン系画面は機能用語可） 🔵 *[brief §5-3]*

### 信頼性

- **NFR-301**: 本機能の追加により既存機能（EX/SBT/Coin/Avatar）へ回帰が生じてはならない 🟡 *[brief §8 AC-RECOVERY-08]*

## 制約

- **CON-001**: Rule#Recoveryは既存Context Ruleの仕組み（`kit.rules.add()`相当）をそのまま利用し、新規コントラクト実装は不要とする 🔵 *[brief §4]*
- **CON-002**: TimeDelayPolicyが本機能で唯一の真に新規なオンチェーンコンポーネントである 🔵 *[brief §4-2]*
- **CON-003**: ProfileContract/IssuerContractへの変更は不要（リカバリ機能はSmart Account自体のContext Rule/Signer/Policy層で完結する） 🔵 *[brief §4]*
- **CON-004**: L5（ZK証明化）は将来フェーズとして本Planのスコープ外とする 🔵 *[brief §9]*
- **CON-005**: 生体認証確認はデータ最小化方針のため本Planのスコープ外とする 🔵 *[brief §9]*
- **CON-006**: 運営承認の完全自動化は行わず、4-eyesの人間承認ステップを維持する。承認者向け管理画面・社内ワークフローツールの実装は本Planのタスクに含めない 🔵 *[brief §9/§12決定3・ユーザー決定]*
- **CON-007**: L3ガーディアン招待のプッシュ通知等の高度なUXは見送り、招待コード共有で足りるものとする 🔵 *[brief §9]*
- **CON-008（§12オープン課題1・ユーザー決定）**: delay_periodの本番値は未決定。実装ではデフォルト値72時間を仮置き定数として実装し、後から調整可能な設計とする。本番値の最終決定は本Planの実装スコープ外とする 🔵 *[ヒアリング決定]*
- **CON-009（ユーザー決定）**: L4の3signerは、運営Delegated Signer、L1じゅもん由来鍵、L1とは独立してクライアント生成・保管する本人第二要素鍵の3つの異なる公開鍵で構成する。重複鍵を別票として登録してはならない。Sもこれらとは独立させる 🔵
- **CON-010（§12オープン課題3・ユーザー決定）**: 4-eyes原則を満たす運営側承認UI・社内ワークフローツールの実装は本Planのスコープ外とする。本Planでは「2名の承認が揃うまで運営鍵の署名実行（enforce相当の判定）が通らない」技術的仕組み（データモデル・APIレベルのゲート）のみを実装対象とする 🔵 *[ヒアリング決定]*
- **CON-011（§12オープン課題4・ユーザー決定・法務レビュー非ブロッキング）**: 運営がThreshold(2)のうち1票のみを持つ設計については、管轄法域の弁護士による法務レビューが望ましいとbriefに記載されているが、本Planは技術実装のみを扱うスコープであるため、**法務レビューの完了は本Planの実装のブロッカーとしない**。法務レビューは別途・別スコープで実施されるものとし、その実施状況・結果に関わらず本要件定義および実装は有効とする 🔵 *[ヒアリング決定・要必ず制約明記]*
- **CON-012**: チーム規模は個人・プロトタイプであり、型安全性・Lint・テストは主要パスのみで許容する。CI/CD・モノレポ構成は導入しない 🟡 *[ヒアリング技術的補足]*
- **CON-013**: フロントエンドはTypeScript + React + Viteとし、`smart-account-kit`をブラウザから直接利用する。Axum relay gatewayとSorobanコントラクトはRustの別ビルド単位とする 🔵 *[ユーザー決定/context.md]*
- **CON-014**: `kit.rules`/`kit.signers`/`kit.policies`/`kit.multiSigners`は公式`stellar/smart-account-kit`をTypeScriptフロントから利用し、独自再実装しない。カスタムTimeDelayPolicyのみSorobanで追加する 🔵 *[ユーザー決定/公式SDK]*
- **CON-015**: Leptos/cargo-leptosは採用しない。Passkey/WebAuthn、smart-account-kit、クライアント暗号、複数署名はTypeScriptフロント内で実行し、秘密材料をAxum APIへ渡してはならない 🔵 *[ユーザー決定]*
- **CON-016**: Protocol 27 localnetでは`smart-account-kit`の直接RPC提出（`forceMethod: "rpc"`相当）で復旧ロジックを検証する。Stellar TestnetではAxum relay gatewayが`{func, auth}`または`{xdr}`をfail-closed検証し、OpenZeppelin Relayer 1.5.x + Channels Pluginへ転送する。Relayer APIキーをブラウザへ公開してはならない 🔵 *[ユーザー決定/公式Relayer仕様]*
- **CON-017**: `smart-account-kit`はpnpm lockfileで正確なバージョンを固定し、Protocol 27を基準とし、そのリリースが要求するaccount WASM hash、verifier/policy contract addressをlocalnet設定と一致させる 🔵 *[公式SDK互換性]*

## 信頼性レベルサマリー

- 🔵 青信号: 73件
- 🟡 黄信号: 4件
- 🔴 赤信号: 0件（要確認なし）
