use std::env;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let workspace_dist = manifest_dir.join("../../web/dist");
    let fallback_dist = manifest_dir.join("fallback_dist");

    println!("cargo:rerun-if-changed={}", workspace_dist.display());
    println!("cargo:rerun-if-changed={}", fallback_dist.display());

    let dist_dir = if workspace_dist.join("index.html").exists() {
        workspace_dist
    } else {
        println!(
            "cargo:warning=web/dist was not found; embedding fallback UI. Run `cd web && npm run build` before building pathlet-app for release."
        );
        fallback_dist
    };

    println!("cargo:rustc-env=PATHLET_DIST_DIR={}", dist_dir.display());
}
