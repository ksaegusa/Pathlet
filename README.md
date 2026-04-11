# pathlet

L3 経路計算を中心に、Intent と実測経路の差分を確認するネットワーク経路シミュレーターです。

現在は Rust の計算ロジックを WebAssembly にして React/Vite から呼び出し、ブラウザ内だけでトポロジ、障害、経路、Intent Evaluation を確認します。サーバサイド API や DB はまだありません。

## 現在できること

- interface 単位の最短経路計算
- link up/down と cost 変更
- ノード down、ポート/interface down の障害試験
- トポロジ JSON の import
- ノード詳細、リンク詳細、冗長 VIP メタデータ表示
- `ICMP` / `TCP` / `UDP` の Traffic Intent 入力
- `reachable` と `via` の expected vs actual 評価
- 任意グループの追加とノード所属変更

未実装の領域:

- ACL / Policy の実評価
- NAT の実評価
- VRRP / HSRP の active 切替ロジック
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

CLI は Rust core と同じ JSON I/F を使います。

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
    ]
  },
  "from_interface": "r1-eth0",
  "to_interface": "r2-eth0"
}
```

成功時:

```json
{ "ok": true, "path": ["r1-eth0", "r2-eth0"], "cost": 10 }
```

失敗時:

```json
{
  "ok": false,
  "error": {
    "code": "unreachable",
    "message": "no route found"
  }
}
```

## トポロジ JSON

Web UI の `JSONを読み込む` から `GraphModel` 形式の JSON を import できます。

サンプル:

- [examples/topologies/dual-dc-hsrp.json](examples/topologies/dual-dc-hsrp.json)
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
};
```

`groups` は任意です。ない場合は既定の `拠点 / WAN / センター / サービス` を使います。

`interfaces[].ip_address` も任意です。ある場合はノード詳細、始点/終点、リンク表示に出ます。

`virtual_ips` は現在メタデータ表示用です。VRRP / HSRP の active 切替を経路計算へ反映する処理はまだありません。

## 計算モデル

Rust core は interface graph を作り、Dijkstra で最短経路を求めます。

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

## Intent Evaluation

現在の Evaluation は `Intent` の期待値と実際の経路計算結果を比較します。

実装済み:

- `reachability`: 期待 reachable/unreachable と実際に経路が出たか
- `via`: 期待した node を経由したか

未実装:

- `policy`
- `nat`

未実装項目は UI 上では `NA` として表示します。

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
