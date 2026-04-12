# Pathlet

L3 経路計算を中心に、通信要件と実際の経路の差分を確認するネットワーク経路シミュレーターです。

現在は Rust の計算ロジックを WebAssembly にして React/Vite から呼び出し、ブラウザ内だけでトポロジ、障害、経路、検証結果を確認します。サーバサイド API や DB はまだありません。

## 現在できること

- interface 単位の最短経路計算
- link up/down と cost 変更
- ノード down、ポート/interface down の障害試験
- トポロジ JSON の import
- ノード詳細、リンク詳細、冗長 VIP メタデータ表示
- `ICMP` / `TCP` / `UDP` の通信要件入力
- 到達性と経由拠点の要件 vs 結果の検証
- 任意グループの追加とノード所属変更
- YANG 寄せの `routing` / `acls` / `acl_attachments` モデル編集

未実装の領域:

- ACL / Policy の実評価
- NAT の実評価
- 冗長 VIP の active 切替ロジック
- 状態保存、共有、認証

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
git tag v0.1.0
git push origin v0.1.0
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

CLI は Rust core と同じ JSON I/F を使います。現時点の CLI は Web UI の YANG 寄せ `routing` / `acls` モデルではなく、core 互換の `routes` モデルを直接受け取ります。

```sh
cargo run -p pathlet-cli -- route --input request.json
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

Dijkstra で終点まで届かない場合は、到達済みの範囲までの部分経路を返します。

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

## トポロジ JSON

Web UI の `JSONを読み込む` から `GraphModel` 形式の JSON を import できます。

サンプル:

- [examples/topologies/dual-dc-vrrp.json](examples/topologies/dual-dc-vrrp.json)
- [examples/topologies/campus-fw-internet.json](examples/topologies/campus-fw-internet.json)
- [examples/topologies/multi-region-vrrp.json](examples/topologies/multi-region-vrrp.json)

主要フィールド:

```ts
type GraphModel = {
  nodes: NodeModel[];
  interfaces: InterfaceModel[];
  links: LinkModel[];
  groups?: NodeGroupModel[];
  virtual_ips?: VirtualIpModel[];
  routing?: YangRoutingModel[];
  acls?: YangAclModel[];
  acl_attachments?: YangAclAttachmentModel[];
};
```

`groups` は任意です。ない場合は既定の `拠点 / WAN / センター / サービス` を使います。

`interfaces[].ip_address` も任意です。ある場合はノード詳細、始点/終点、リンク表示に出ます。

`virtual_ips` は現在メタデータ表示用です。VIP は active / standby のネットワーク機器に紐づけて表現します。冗長 VIP の active 切替を経路計算へ反映する処理はまだありません。

`routing` はノードごとのルーティング情報です。RFC 8349 の `routing` / `control-plane-protocols` / `static-routes` に寄せた構造で保持します。ノード詳細から参照・編集できます。将来の VRF / VLAN 対応を見越して、各エントリは任意の `vrf_id` と `vlan_id` を持てます。

`acls` は RFC 8519 の `acl` / `aces` / `matches` / `actions` に寄せたPolicy定義です。`acl_attachments` で各ノードの ingress / egress に適用するACLを指定します。現在は設定メタデータとして保持し、経路評価への適用はまだ行いません。

Web UI は旧形式の `routes` / `policies` も読み取り互換として扱います。ただし保存・編集時の主モデルは `routing` / `acls` / `acl_attachments` です。WASM の Rust core はまだ旧 `routes` 形式を読むため、Web 側で `routing` から core 用 route へ変換してから呼び出しています。

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
      "ingress": ["primary-center-ingress"]
    }
  ]
}
```

## 計算モデル

Rust core は 2 つの計算モードを持ちます。

- `shortest_path`: interface graph を作り、Dijkstra で最短経路を求めます。
- `routing_table`: ノードごとの `routing` を互換レイヤで core 用 route に変換し、hop-by-hop に lookup して `reachable` / `no_route` / `loop` / `blackhole` を返します。

`routing_table` は現在、宛先 node/interface の完全一致、宛先 IPv4/CIDR、default route (`0.0.0.0/0`) を扱います。VRF / VLAN はモデルとして保持しますが、lookup の分離条件としてはまだ使っていません。

隣接リストの概念:

```rust
HashMap<String, Vec<(String, u32)>>
// interface_id -> [(neighbor_interface_id, cost)]
```

エッジは次の 2 種類です。

- active な Link: `from_interface <-> to_interface` を `link.cost` で接続
- 同一 Node 内の Interface: 機器内転送として `interface <-> interface` を cost `0` で接続

これにより、複数 interface を持つノードでは ingress interface から egress interface へ通過できます。

Web UI のノード down / ポート down は、ブラウザ上で実効トポロジを作り、対象ノードまたは interface に接続する link を `active: false` として WASM に渡します。元の JSON 定義自体は直接破壊しません。

## 検証結果

現在の検証結果は、通信要件と実際の経路計算結果を比較します。

実装済み:

- `到達性`: 要件の到達可能/到達不可と実際の経路状態
- `経由拠点`: 指定した node を経由したか

未実装:

- `policy` の判定適用
- `nat`

未実装項目は UI 上では `未評価` として表示します。経由拠点が未指定など、今回の通信要件に該当しない項目は `対象外` として表示します。

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
