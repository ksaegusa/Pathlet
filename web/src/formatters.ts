import type { ActiveModal, ReachabilityScope, RouteStatus, TrafficIntent, TrafficTestResultModel } from "./types";

export type EvaluationStatus = "OK" | "NG" | "not_implemented";

export function trafficLabel(intent: TrafficIntent) {
  const protocol = intent.protocol.toUpperCase();
  return intent.port ? `${protocol}/${intent.port}` : protocol;
}

export function reachabilityLabel(reachable: boolean) {
  return reachable ? "到達可能" : "到達不可";
}

export function reachabilityScopeLabel(scope: ReachabilityScope | undefined) {
  return scope === "forward_only" ? "片道（往路のみ）" : "往復";
}

export function routeStatusLabel(status: RouteStatus | undefined) {
  if (status === "unreachable") {
    return "到達不可";
  }
  if (status === "loop") {
    return "ループ";
  }
  if (status === "no_route") {
    return "経路なし";
  }
  if (status === "blackhole") {
    return "ブラックホール";
  }
  if (status === "policy_denied") {
    return "Policy deny";
  }
  return "到達可能";
}

export function evaluationStatusLabel(status: EvaluationStatus) {
  if (status === "not_implemented") {
    return "未評価";
  }
  return status;
}

export function modalTitle(activeModal: ActiveModal) {
  if (activeModal === "link") {
    return "リンク編集";
  }
  if (activeModal === "node") {
    return "ノード詳細";
  }
  if (activeModal === "test") {
    return "通信試験詳細";
  }
  return "トポロジ編集";
}

export function testResultLabel(status: TrafficTestResultModel["status"] | undefined) {
  if (status === "pass") {
    return "PASS";
  }
  if (status === "fail") {
    return "FAIL";
  }
  if (status === "error") {
    return "ERROR";
  }
  return "未実行";
}
