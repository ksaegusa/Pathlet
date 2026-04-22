# Pathlet

ネットワーク設計レビューを機械化するために、通信要件と実際の経路の差分を評価するツールです。

現在は Rust の計算ロジックを WebAssembly にして React/Vite から呼び出し、ブラウザ内だけでトポロジ、障害、経路、検証結果を確認します。サーバサイド API や DB はまだありません。

## 現在できること

- interface 単位の最短経路計算
- link up/down と cost 変更
- ノード down、ポート/interface down の障害試験
- トポロジ JSON/YAML の import と YAML export
- 試験とトポロジ図、設計問題、技術原因、改善案の連動表示
- リンク詳細、冗長 VIP メタデータ表示
- `ICMP` / `TCP` / `UDP` の通信要件入力
- 到達性と往復/片道の要件 vs 結果の検証
- 通信試験データの import/export と Markdown レポート export
- 任意グループの追加とノード所属変更
- YANG JSON 互換サブセットを目標にした `routing` / `acls` / `acl_attachments` モデル編集
- `nat_rules` による source/destination NAT の基本評価
- ELK によるトポロジ自動レイアウト

未実装の領域:

- 冗長 VIP の active 切替ロジック
- 状態保存、共有、認証

## 基本的な使い方

Pathlet の Web UI は、トポロジ設定を直接読むための画面ではなく、通信試験が設計として成立しているかをレビューするための画面です。

1. `試験` で送信元、宛先、protocol、port、期待結果、往復/片道を指定します。
2. 試験を実行し、`設計確認` のトポロジ図でその通信が通るノード、止まる箇所、経路外ノードを確認します。
3. `設計評価` で、実通信の到達性、意図と実際のズレ、設計問題、技術原因を分けて確認します。
4. 必要に応じて `ルール編集` で Routing / Policy / NAT を修正します。
5. 単発で確認したい場合だけ、`設計確認` の `手動確認` を使います。

表示上は `実通信` と `設計評価` を分けています。たとえば「到達不可を期待していて、実際に復路がない」場合は、実通信は `BLOCKED`、設計評価は `PASS`、設計問題は `復路設計不足`、技術原因は `REV_ROUTE_MISSING` と表示します。

## ディレクトリ構成

```text
pathlet/
├── crates/
│   ├── core/      # Rust の経路計算ロジック
│   ├── cli/       # CLI ラッパー
│   ├── wasm/      # wasm-bindgen の WebAssembly バインディング
│   └── app/       # web/dist を埋め込んだ単一バイナリ配信用アプリ
├── examples/
│   └── topologies/ # import 用サンプルトポロジ JSON
└── web/           # React + Vite UI
```

## 必要なもの

- Rust toolchain
- `wasm32-unknown-unknown` target
- `wasm-pack`
- Node.js / npm

初回セットアップ:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
cd web
npm install
```

`wasm-pack` がすでに入っている場合、`cargo install wasm-pack` は不要です。

## 開発

Rust 側のテスト:

```sh
cargo test --workspace
```

WASM を生成:

```sh
cd web
npm run build:wasm
```

Web 開発サーバ:

```sh
cd web
npm run dev
```

デフォルトでは Vite が `http://localhost:5173/` を使います。

## WebAssembly の構成

WASM の入口は [crates/wasm/src/lib.rs](crates/wasm/src/lib.rs) です。

```rust
#[wasm_bindgen]
pub fn shortest_path(json: &str) -> String {
    pathlet_core::calculate_route_json(json)
}
```

つまり Web 側から見ると、WASM は JSON 文字列を受け取り JSON 文字列を返す薄い境界です。実際の経路計算は [crates/core](crates/core) に置いています。

WASM 生成コマンド:

```sh
cd web
npm run build:wasm
```

この script は内部で次を実行します。

```sh
cd ../crates/wasm
wasm-pack build --target web --out-dir ../../web/src/wasm
```

生成先:

```text
web/src/wasm/
├── pathlet_wasm.js
├── pathlet_wasm_bg.wasm
├── pathlet_wasm.d.ts
└── package.json
```

`--target web` を使っているため、Vite 側では ESM として読み込みます。Node.js 用や bundler 専用 target ではありません。

重要な点:

- `web/src/wasm` は生成物です。
- `npm run build` は先に `npm run build:wasm` を実行します。
- Rust 側の `crates/core` または `crates/wasm` を変更したら、WASM を再生成する必要があります。
- Vite dev server 起動中でも、WASM を再生成するとページ reload が走ります。
- `pathlet_wasm_bg.wasm` は最終的に Vite build によって `dist/assets` 配下へ含まれます。

## 本番ビルド

```sh
cd web
npm run build
```

このコマンドは次を順に実行します。

```text
1. npm run build:wasm
2. tsc
3. vite build
```

成果物:

```text
web/dist/
```

`web/dist` は静的ファイルだけなので、Nginx、S3 + CloudFront、Cloudflare Pages、Netlify、Vercel などで配信できます。

ローカルで本番ビルドを確認:

```sh
cd web
npm run preview
```

## 単一バイナリ配布

Windows などで Node.js や Rust を入れずに使う利用者向けには、`web/dist` を Rust バイナリへ埋め込んだ `pathlet` を配布できます。

ビルド手順:

```sh
cd web
npm ci
npm run build
cd ..
cargo build --release -p pathlet-app
```

成果物:

```text
target/release/pathlet
target/release/pathlet.exe   # Windows の場合
```

実行:

```sh
target/release/pathlet
```

このバイナリは内部で次を行います。

1. 埋め込まれた `web/dist` をローカル HTTP サーバで配信
2. `127.0.0.1` の空きポートを使用
3. 既定ブラウザで URL を開く

ブラウザを自動で開かない場合:

```sh
target/release/pathlet --no-open
```

ポートを固定する場合:

```sh
target/release/pathlet --port 8080
```

別ホストで listen する場合:

```sh
target/release/pathlet --host 0.0.0.0 --port 8080 --no-open
```

注意:

- `crates/app` は compile 時点の `web/dist` をバイナリに埋め込みます。
- UI や WASM を変更したら、先に `npm run build` を実行してから `cargo build --release -p pathlet-app` を実行してください。
- 生成された単一バイナリには Vite の JS/CSS と WASM が含まれます。利用者側に Node.js、wasm-pack、Rust は不要です。

### GitHub Actions で成果物を作る

[.github/workflows/release.yml](.github/workflows/release.yml) は Linux / macOS / Windows 向けに単一バイナリをビルドします。`workflow_dispatch` で手動実行するか、`v*` tag を push すると動きます。tag push の場合は GitHub Release にも成果物を添付します。

```sh
git tag v0.2.0
git push origin v0.2.0
```

成果物は workflow run の Artifacts、または tag push で作成された GitHub Release から取得できます。

```text
pathlet-linux-x64.tar.gz
pathlet-macos-arm64.tar.gz
pathlet-windows-x64.zip
```

各アーカイブには `pathlet` / `pathlet.exe`、`README.md`、`LICENSE` が含まれます。

## デプロイ手順

最小手順:

```sh
cd web
npm ci
npm run build
```

配信対象:

```text
web/dist
```

Nginx 例:

```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/pathlet/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.wasm$ {
        types {
            application/wasm wasm;
        }
        try_files $uri =404;
    }
}
```

多くの静的ホスティングでは `.wasm` の MIME type を自動設定します。もし WASM 読み込みで失敗する場合は、`application/wasm` が返っているか確認してください。

Cloudflare Pages / Netlify / Vercel のような静的ホスティングでは:

```text
build command: cd web && npm ci && npm run build
publish directory: web/dist
```

リポジトリルートから `web` に移動して build する点に注意してください。

## CLI

CLI は Rust core と同じ JSON I/F を使います。入力ファイルは JSON/YAML のどちらでも読めます。`routing_table` モードでは YANG JSON 互換サブセットを目標にした `routing` を直接読めます。旧 `routes` 形式も互換入力として残しています。

```sh
cargo run -p pathlet-cli -- route --input request.json
```

YAML 入力:

```sh
cargo run -p pathlet-cli -- route --input request.yaml
```

省略形:

```sh
cargo run -p pathlet-cli -- route request.json
```

入力例:

```json
{
  "graph": {
    "nodes": [{ "id": "r1" }, { "id": "r2" }],
    "interfaces": [
      { "id": "r1-eth0", "node_id": "r1", "ip_address": "10.0.0.1/30" },
      { "id": "r2-eth0", "node_id": "r2", "ip_address": "10.0.0.2/30" }
    ],
    "links": [
      {
        "id": "r1-r2",
        "from_interface": "r1-eth0",
        "to_interface": "r2-eth0",
        "cost": 10,
        "active": true
      }
    ],
    "routes": []
  },
  "from_interface": "r1-eth0",
  "to_interface": "r2-eth0",
  "mode": "shortest_path"
}
```

成功時:

```json
{
  "ok": true,
  "path": ["r1-eth0", "r2-eth0"],
  "equal_cost_paths": [["r1-eth0", "r2-eth0"]],
  "cost": 10,
  "status": "reachable",
  "matched_route_ids": [],
  "loop_link_ids": []
}
```

Dijkstra で終点まで届かない場合は、到達済みの範囲までの部分経路を返します。`equal_cost_paths` は UI / WASM の応答性を守るため最大64件に制限します。

```json
{
  "ok": true,
  "path": ["r1-eth0"],
  "equal_cost_paths": [["r1-eth0"]],
  "cost": 0,
  "status": "unreachable",
  "matched_route_ids": [],
  "loop_link_ids": []
}
```

## トポロジ JSON/YAML

Web UI の `JSON/YAMLを読み込む` から `GraphModel` 形式または `RouteRequest` 形式の JSON/YAML を import できます。現在のトポロジは `YAMLでExport` から YAML として書き出せます。`試験` からはトポロジとは別ファイルの試験JSON/YAMLを読み込み、現在の試験一覧を置き換えられます。試験一覧は `試験YAMLでExport` から YAML として書き出せ、実行結果は `レポートExport` から Markdown として書き出せます。

スキーマ方針は [docs/schema.md](docs/schema.md) にまとめています。Pathlet は標準 YANG の一部に見える独自形ではなく、RFC 7951 の YANG JSON 互換サブセットを外部 I/O の目標にします。ただし現在の `GraphModel` は複数ノードを持つ Pathlet の graph envelope であり、標準 YANG JSON を完全に import/export する実装ではまだありません。

サンプル:

- [examples/topologies/dual-dc-vrrp.json](examples/topologies/dual-dc-vrrp.json)
- [examples/topologies/campus-fw-internet.json](examples/topologies/campus-fw-internet.json)
- [examples/topologies/multi-region-vrrp.json](examples/topologies/multi-region-vrrp.json)
- [examples/topologies/large-enterprise-80.json](examples/topologies/large-enterprise-80.json) は 80 nodes / 115 links / 230 interfaces の描画・検索確認用サンプルです。
- [examples/topologies/yang-json-minimal.json](examples/topologies/yang-json-minimal.json) は YANG JSON 風の namespace 付き JSON と `pathlet:*` 拡張の最小例です。

主要フィールド:

```ts
type GraphModel = {
  nodes: NodeModel[];
  interfaces: YangInterfaceNodeModel[];
  links: LinkModel[];
  groups?: NodeGroupModel[];
  virtual_ips?: VirtualIpModel[];
  routing?: YangRoutingModel[];
  acls?: YangAclModel[];
  acl_attachments?: YangAclAttachmentModel[];
};
```

`nodes[].device_type` は `network_device` または `client` です。省略時は既存互換のため `network_device` として扱います。Client は1ポートとデフォルトルートを基本にし、Web UI のリンク追加でも既に接続済みの Client には追加接続しません。Network Device は routing / ACL / VIP などのネットワーク機能を持つノードとして扱います。

`groups` は任意です。ない場合は既定の `拠点 / WAN / センター / サービス` を使います。

`interfaces` は RFC 8343 `ietf-interfaces` / `ietf-ip` の `interfaces/interface` を互換ターゲットにしたノード単位の構造で export します。Web UI と Rust core は旧フラット形式の `InterfaceModel[]` も読み取り互換として扱います。現時点では Pathlet の `node_id` を持つ graph envelope 内のサブセットであり、RFC 7951 の namespace 付き JSON を完全に表すものではありません。

`interfaces[].interfaces.interface[].ipv4.address` も任意です。ある場合は始点/終点、リンク表示、通信試験のIP解決に使います。

`interfaces` の最小例:

```json
{
  "interfaces": [
    {
      "node_id": "primary-center",
      "interfaces": {
        "interface": [
          {
            "name": "primary-center-wan-if",
            "enabled": true,
            "ipv4": {
              "address": [{ "ip": "10.10.0.1", "prefix_length": 24 }]
            }
          }
        ]
      }
    }
  ]
}
```

`virtual_ips` は現在メタデータ表示用です。VIP は active / standby のネットワーク機器に紐づけて表現します。冗長 VIP の active 切替を経路計算へ反映する処理はまだありません。

`routing` はノードごとのルーティング情報です。RFC 8349 `ietf-routing` と `ietf-ipv4-unicast-routing` を互換ターゲットにした `routing` / `control-plane-protocols` / `static-routes` のサブセットとして保持します。ルール編集画面から参照・編集できます。各エントリは任意の `vrf_id` と `vlan_id` を持てます。VRF / VLAN は routing lookup と link 通過条件に使います。これら Pathlet 固有フィールドは、外部 YANG JSON adapter では `pathlet:*` 拡張として扱う方針です。

`acls` は RFC 8519 `ietf-access-control-list` の `acl` / `aces` / `matches` / `actions` を互換ターゲットにした Policy 定義です。`acl_attachments` で各ノードの ingress / egress に適用する ACL を指定します。`acl_attachments[].interface_id` がある場合は対象 interface にだけ適用し、省略時は node-wide ACL として扱います。`acl_attachments` は Pathlet の graph-level attachment であり、標準 ACL module そのものではありません。経路計算後の path に対して TCP / UDP / ICMP、送信元/宛先 IPv4/CIDR、destination port `eq` を評価し、deny に一致した場合は `policy_denied` として返します。

Web UI は旧形式の `routes` / `policies` も読み取り互換として扱います。ただし保存・編集時の主モデルは `routing` / `acls` / `acl_attachments` です。Rust core も `routing` を直接読み、`routing` が空の場合だけ旧 `routes` を使います。

通信試験ファイルはトポロジとは別に保持します。`source` と `destination` は既存 `interfaces` の `ip_address` とホスト部が一致するホストIPを指定します。`10.0.0.1` と `10.0.0.1/24` は同じホストIPとして扱いますが、UI上の入力はネットマスクなしのIPを基本にします。UIは一致した interface を既存の `RouteRequest.from_interface` / `to_interface` に変換し、現在のトポロジと停止状態に対して Policy / NAT を含む `routing_table` 判定で実行します。

`expectations.scope` は `round_trip` または `forward_only` です。省略時は `round_trip` として扱います。`round_trip` は往路と復路を含む到達性、`forward_only` は往路だけの到達性を判定します。

通信試験の最小例:

```yaml
version: 1
tests:
  - id: app-https
    name: Osaka to public API
    enabled: true
    source: 10.1.0.10
    destination: 203.0.113.10
    protocol: tcp
    port: 443
    expectations:
      reachable: true
      scope: round_trip
  - id: blocked-dns
    name: Osaka to blocked DNS
    enabled: true
    source: 10.1.0.10
    destination: 172.16.100.53
    protocol: udp
    port: 53
    expectations:
      reachable: false
      scope: forward_only
```

`routing` の最小例:

```json
{
  "routing": [
    {
      "node_id": "osaka-wan",
      "routing": {
        "control_plane_protocols": [
          {
            "type": "static",
            "name": "static",
            "static_routes": {
              "ipv4": [
                {
                  "name": "osaka-wan-primary",
                  "destination_prefix": "primary-center",
                  "next_hop": {
                    "next_hop_node": "primary-center",
                    "outgoing_interface": "osaka-wan-osaka-primary-if"
                  },
                  "metric": 20,
                  "administrative_distance": 1,
                  "vrf_id": "default",
                  "vlan_id": 100,
                  "active": true
                }
              ]
            }
          }
        ]
      }
    }
  ]
}
```

ACL の最小例:

```json
{
  "acls": [
    {
      "name": "primary-center-ingress",
      "type": "ipv4-acl",
      "aces": [
        {
          "name": "allow-https-to-erp",
          "active": true,
          "matches": {
            "ipv4": {
              "source_ipv4_network": "10.0.0.0/8",
              "destination_ipv4_network": "10.10.0.10/32"
            },
            "tcp": {
              "destination_port": { "operator": "eq", "port": 443 }
            }
          },
          "actions": { "forwarding": "accept" }
        }
      ]
    }
  ],
  "acl_attachments": [
    {
      "node_id": "primary-center",
      "interface_id": "primary-center-wan-if",
      "ingress": ["primary-center-ingress"]
    }
  ]
}
```

## 計算モデル

Rust core は 2 つの計算モードを持ちます。

- `shortest_path`: interface graph を作り、Dijkstra で最短経路を求めます。
- `routing_table`: ノードごとの `routing` を読み、hop-by-hop に lookup して `reachable` / `no_route` / `loop` / `blackhole` を返します。

`routing_table` は現在、宛先 node/interface の完全一致、宛先 IPv4/CIDR、default route (`0.0.0.0/0`) を扱います。VRF は送信元 interface の `vrf_id`、なければ node の `default_vrf_id`、さらにない場合は `default` として lookup 条件に使います。VLAN は送信元 interface の `vlan_id`、なければ node の `default_vlan_id` を lookup / link 通過条件に使います。link に `vlan_id` がある場合は有効 VLAN と一致する場合だけ通過できます。

直結している宛先 node へは、明示的な static route がなくても到達可能として扱います。宛先 IP が分かる場合は、現在 node の egress interface prefix に一致する直結 link を優先します。prefix に一致する link が見つからない場合は、既存トポロジ互換のため、宛先 node への active な直結 link を fallback として使います。

### Policy / NAT の適用順

現在の実装は固定パイプラインです。forward 方向は DNAT、route lookup、path 上の Policy、SNAT の順に評価し、戻り方向は stateful return として return route と reverse NAT を確認します。

```text
DNAT -> route lookup -> ingress / egress Policy -> SNAT
```

Policy と NAT は path 上の interface ペアを送信方向に順に見ます。各 hop で `from_interface` 側を `egress`、`to_interface` 側を `ingress` として扱います。

Return traffic は forward で許可された flow の戻りとして扱うため、戻り方向の Policy は再評価しません。device/vendor ごとの pre-routing / post-routing 差分はまだ扱いません。

### cost と metric

Pathlet では `link.cost` と `routing[].static_routes.ipv4[].metric` を分けて扱います。

- `link.cost`: interface/link の cost。サンプルでは `bandwidth_mbps` から `ceil(100000 / bandwidth_mbps)` で初期値を設定します。100Gbps=1、40Gbps=3、1Gbps=100、100Mbps=1000 です。
- `route.metric`: 同一ノード上の route 候補を比較するための値です。`administrative_distance` が同じ場合に、小さい metric を優先します。

BGP は帯域costではなくLOCAL_PREFなどの経路属性とpolicyを中心に選ぶため、今後BGPを扱う場合は `link.cost` ではなく route/policy 属性として別モデルにします。

隣接リストの概念:

```rust
HashMap<String, Vec<(String, u32)>>
// interface_id -> [(neighbor_interface_id, cost)]
```

エッジは次の 2 種類です。

- active な Link: `from_interface <-> to_interface` を `link.cost` で接続
- 同一 Node 内の Interface は、簡易モデルとして `interface <-> interface` cost `0` で接続
- この挙動は現在の Pathlet の簡略化であり、装置内部の厳密な forwarding 制約はまだ表現しない

Web UI のノード down / ポート down は、ブラウザ上で実効トポロジを作り、対象ノードまたは interface に接続する link を `active: false` として WASM に渡します。元の JSON 定義自体は直接破壊しません。

## 検証結果

現在の検証結果は、通信要件と実際の経路計算結果を比較します。UIでは、判断時に混ざりやすい情報を次の3つに分けます。

実装済み:

- `到達性`: 要件の到達可能/到達不可と実際の経路状態
- `往復/片道`: 往路だけ、または復路を含む到達性
- `実通信`: `REACHABLE` / `BLOCKED` / `NOT CHECKED`
- `設計評価`: 期待結果と実通信が一致するか
- `原因`: `REV_ROUTE_MISSING` / `POLICY_DENY` / `NO_ROUTE` など

Routing / Policy / NAT の詳細は、通信可否を説明する pipeline 詳細として折りたたみ表示します。試験では、実通信、期待との評価、原因コードを分けて表示します。原因の参照情報は `routes` / `policy` / `NAT` を分けて表示し、主原因を強調します。設計確認では修正ポイントと候補アクションを先に表示します。

## 今回含めない範囲

このバージョンでは、設計確認UIの整理を優先し、次の領域は対象外です。

- 原因から設定修正案を自動生成して適用する機能
- 複数VRF間の本格的な route leaking
- OSPF / BGP などの動的ルーティングプロトコル
- RFC 7951 / RFC 8343 / RFC 8349 / RFC 8519 の完全対応
- vendor 固有の pre-routing / post-routing / NAT / ACL 差分の再現

## トラブルシュート

### `wasm-pack: command not found`

```sh
cargo install wasm-pack
```

### `can't find crate for core` や `wasm32-unknown-unknown` 関連のエラー

```sh
rustup target add wasm32-unknown-unknown
```

### ブラウザで WASM が読めない

本番配信時に `.wasm` が `application/wasm` で返っているか確認してください。

```sh
curl -I https://example.com/assets/pathlet_wasm_bg-xxxxx.wasm
```

### Rust を変えたのに Web に反映されない

WASM を再生成してください。

```sh
cd web
npm run build:wasm
```

`npm run build` は自動で `build:wasm` を実行しますが、dev server 中に Rust だけ変更した場合は手動再生成が必要です。
