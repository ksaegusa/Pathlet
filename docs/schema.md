# Pathlet Schema Policy

Pathlet のトポロジモデルは、標準 YANG の一部に見える独自形ではなく、YANG JSON と互換にできる範囲を明示して扱う。

## 方針

- 外部 I/O は RFC 7951 の YANG JSON 互換サブセットを目標にする。
- 内部計算は Pathlet の正規化モデルで行う。
- 互換層は `YANG JSON <-> Pathlet normalized model` の adapter として分離する。
- Pathlet 独自のグラフ表現は `pathlet:*` 拡張 namespace として扱う。
- 未対応フィールドは暗黙に別意味へ読み替えない。保持できるものは保持し、保持できないものは未対応として明示する。

## 対象モジュール

最初に対象にする標準 YANG モジュールは次の範囲に絞る。

- `ietf-interfaces`
- `ietf-ip`
- `ietf-routing`
- `ietf-ipv4-unicast-routing`
- `ietf-access-control-list`

NAT、VIP、トポロジ link、node 種別、描画座標、検証用メタデータは現時点では標準互換を名乗らず、Pathlet 拡張として扱う。

## 現在のモデル

現在の `GraphModel` は単一機器の設定ではなく、複数ノードを持つ Pathlet のグラフトポロジを表す envelope である。そのため、現状の `interfaces` / `routing` / `acls` は標準 YANG JSON そのものではない。

現在の `interfaces` はノード単位で `node_id` を持ち、その配下に `interfaces.interface[]` を置く。これは `ietf-interfaces` / `ietf-ip` の構造を取り込むための互換ターゲットであり、RFC 7951 の namespace 付き JSON を完全に import/export する実装ではまだない。

現在の `routing` はノード単位で `node_id` を持ち、その配下に `routing.control_plane_protocols[].static_routes.ipv4[]` を置く。これは `ietf-routing` / `ietf-ipv4-unicast-routing` をターゲットにしたサブセットであり、Pathlet 独自の `next_hop_node`、`active`、`vrf_id`、`vlan_id` を含む。

現在の `acls` と `acl_attachments` は `ietf-access-control-list` をターゲットにしたサブセットである。`acl_attachments` は Pathlet のノード/interface へ ACL を適用するための graph-level attachment で、標準 ACL module そのものではない。

`routing_table` mode では、connected route を暗黙に扱う。宛先 node が active link で直結している場合、明示的な static route がなくても転送候補にする。宛先 IP が分かる場合は egress interface の prefix と一致する直結 link を優先し、一致がない場合は既存トポロジ互換のため active な直結 link へ fallback する。VRF / VLAN による connected route の分離はまだ行わない。

## 現在の Policy / NAT パイプライン

現在の Rust core は、固定の Pathlet 標準 pipeline で評価する。

```text
DNAT -> route lookup -> ingress / egress Policy -> SNAT
```

Policy と NAT は path 上の interface ペアを送信方向に走査する。各 hop では `from_interface` 側を `egress`、`to_interface` 側を `ingress` として扱う。

現時点の制限:

- Policy は各 pipeline stage 時点の packet source / destination を見る。
- Return traffic は forward で許可された flow の戻りとして扱い、戻り方向の Policy は再評価しない。
- NAT rule は同じ interface / direction で最初に match した rule だけを適用する。
- vendor ごとの pre-routing / post-routing 差分は未実装。

厳密に扱う場合は、device type や vendor profile によって pipeline 順序を切り替えられるようにする。

## 拡張 namespace

YANG JSON 互換 import/export を実装する時は、Pathlet 固有フィールドを標準 module の一部として見せない。

Pathlet 固有として扱う代表例:

- `pathlet:node-id`
- `pathlet:link`
- `pathlet:device-type`
- `pathlet:position`
- `pathlet:group`
- `pathlet:vip`
- `pathlet:nat-rule`
- `pathlet:active`
- `pathlet:next-hop-node`
- `pathlet:vrf-id`
- `pathlet:vlan-id`

実装上の TypeScript/Rust の field 名は当面 snake_case のままでもよいが、外部 YANG JSON adapter では namespace 付き field として出す。

## VLAN と Tunnel

VLAN と Tunnel は L2/L3 の境界があるため、routing lookup の条件へ混ぜ込む前にモデルを分ける。

- VLAN は interface/link の L2 属性として保持する。L3 lookup の VRF 分離条件として使う場合は、別途 bridge domain / SVI / routed interface の関係を定義してから使う。
- Tunnel は L3 overlay interface として扱う。外側経路、内側経路、encapsulation endpoint を分ける。
- 標準 module の選定が終わるまでは、VLAN/Tunnel は Pathlet 拡張に置く。

## 実装ステップ

1. README と docs から曖昧な互換表現を消し、互換ターゲットと現状制限を分ける。
2. Rust core の `Yang*` 型を、標準互換 DTO と Pathlet internal model に分ける。
3. TypeScript 側も import/export adapter を `graphModel.ts` から分離する。
4. RFC 7951 の namespace 付き JSON を import/export するテスト fixture を追加する。
5. `pathlet:*` 拡張を含む round-trip テストを追加する。

この順番にすると、現在の UI と経路計算を壊さずに、互換性の範囲をレビューしやすい単位で進められる。
