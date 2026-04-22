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

現在の `routing` はノード単位で `node_id` を持ち、その配下に `routing.control_plane_protocols[].static_routes.ipv4[]` を置く。これは `ietf-routing` / `ietf-ipv4-unicast-routing` をターゲットにしたサブセットであり、Pathlet 独自の `next_hop_node`、`active`、`vrf_id`、`vlan_id` を含む。RFC 7951 の namespace 付き JSON は `yang_json` adapter の対象であり、内部計算モデルとは分離して扱う。最小 fixture は `examples/topologies/yang-json-minimal.json` に置く。

現在の `acls` と `acl_attachments` は `ietf-access-control-list` をターゲットにしたサブセットである。`acl_attachments` は Pathlet のノード/interface へ ACL を適用するための graph-level attachment で、標準 ACL module そのものではない。

`routing_table` mode では、connected route を暗黙に扱う。宛先 node が active link で直結している場合、明示的な static route がなくても転送候補にする。宛先 IP が分かる場合は egress interface の prefix と一致する直結 link を優先し、一致がない場合は既存トポロジ互換のため active な直結 link へ fallback する。VRF は送信元 interface の `vrf_id`、なければ node の `default_vrf_id`、さらにない場合は `default` として lookup 条件に使う。VLAN は送信元 interface の `vlan_id`、なければ node の `default_vlan_id` を lookup / link 通過条件に使う。link に `vlan_id` がある場合は有効 VLAN と一致する場合だけ通過でき、link の `vlan_id` がない場合は既存互換の untagged/wildcard link として扱う。

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
- `pathlet:default-vrf-id`
- `pathlet:default-vlan-id`
- `pathlet:vlan-id`

実装上の TypeScript/Rust の field 名は当面 snake_case のままでもよいが、外部 YANG JSON adapter では namespace 付き field として出す。

## VLAN と Tunnel

VLAN と Tunnel は L2/L3 の境界があるため、routing lookup の条件へ混ぜ込む前にモデルを分ける。

- VLAN は今回、interface/node の有効 VLAN と link の単一 `vlan_id` の一致条件として扱う。bridge domain / SVI / routed interface / trunk allowed VLAN list はまだ扱わない。
- ノード内の interface 間転送は現在、簡易モデルとして同一ノード内全結線で扱う。zone-based firewall や line card / switching fabric 制約はまだ扱わない。
- Tunnel は L3 overlay interface として扱う。外側経路、内側経路、encapsulation endpoint を分ける。
- 標準 module の選定が終わるまでは、VLAN/Tunnel は Pathlet 拡張に置く。

## 今回含めない範囲

- RFC 7951 / RFC 8343 / RFC 8349 / RFC 8519 の完全対応。
- IPv6。
- dynamic routing protocol、RIB/FIB priority、policy based routing。
- bridge domain、SVI、trunk allowed VLAN list、複数VLAN link。
- vendor別 pipeline profile。
- stateful/stateless firewall mode切り替え。
- NAT pool、PAT、static/dynamic NATの厳密なvendor互換。
- VIP active切替ロジック。
- 認証、共有、永続保存、サーバAPI。
- ELK chunkサイズ改善やWorker化。

## 今回入れた範囲

- README と docs から、標準互換ターゲット、Pathlet 拡張、現状制限を分離した。
- Rust core に YANG JSON namespace 付き DTO adapter を追加し、Pathlet internal `Graph` へ正規化する境界を置いた。
- TypeScript 側も YANG JSON namespace 付き import adapter を `graphModel.ts` から分離した。
- YANG JSON 風の最小 fixture を `examples/topologies/yang-json-minimal.json` と Rust test に追加した。
- `routing_table` lookup で VRF と VLAN を評価するようにした。

## 残タスク

- export 側の YANG JSON adapter と round-trip test。
- 既存の legacy `Yang*` 型名の完全な DTO/internal model 分離。
- ACL / NAT / VIP の namespace 付き adapter。
- 未対応フィールドを保持する passthrough 領域。
