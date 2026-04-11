use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub fn shortest_path(json: &str) -> String {
    pathlet_core::calculate_route_json(json)
}
