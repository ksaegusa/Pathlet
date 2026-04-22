import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseRoute, scopeExpectationMatched } from "./diagnosis";
import type { RouteResponse, TrafficIntent } from "./types";

function baseIntent(overrides?: Partial<TrafficIntent>): TrafficIntent {
  return {
    source_node_id: "src",
    destination_node_id: "dst",
    protocol: "tcp",
    port: 443,
    expectations: {
      reachable: true,
      scope: "round_trip",
      ...(overrides?.expectations ?? {}),
    },
    ...overrides,
  };
}

function okResponse(overrides?: Partial<Extract<RouteResponse, { ok: true }>>): Extract<RouteResponse, { ok: true }> {
  return {
    ok: true,
    path: ["src-if", "mid-if", "dst-if"],
    cost: 10,
    status: "reachable",
    matched_route_ids: [],
    matched_policy_ids: [],
    matched_nat_rule_ids: [],
    forward: {
      path: ["src-if", "mid-if", "dst-if"],
      status: "reachable",
      matched_route_ids: [],
      matched_policy_ids: [],
      matched_nat_rule_ids: [],
    },
    return_path: {
      path: ["dst-if", "mid-if", "src-if"],
      status: "reachable",
      matched_route_ids: [],
      matched_policy_ids: [],
      matched_nat_rule_ids: [],
    },
    ...overrides,
  };
}

test("scopeExpectationMatched returns true for reachable forward_only traffic", () => {
  const response = okResponse({
    forward: {
      path: ["src-if", "dst-if"],
      status: "reachable",
      matched_route_ids: [],
      matched_policy_ids: [],
      matched_nat_rule_ids: [],
    },
    return_path: undefined,
  });
  const intent = baseIntent({
    expectations: {
      reachable: true,
      scope: "forward_only",
    },
  });

  assert.equal(scopeExpectationMatched(response, intent), true);
});

test("scopeExpectationMatched returns false when round_trip traffic only has forward path", () => {
  const response = okResponse({
    status: "no_route",
    return_path: {
      path: ["dst-if"],
      status: "no_route",
      matched_route_ids: [],
      matched_policy_ids: [],
      matched_nat_rule_ids: [],
    },
  });
  const intent = baseIntent({
    expectations: {
      reachable: true,
      scope: "round_trip",
    },
  });

  assert.equal(scopeExpectationMatched(response, intent), false);
});

test("diagnoseRoute keeps return path gap as route design issue when return leg has route evidence", () => {
  const response = okResponse({
    status: "no_route",
    forward: {
      path: ["src-if", "mid-if", "dst-if"],
      status: "reachable",
      matched_route_ids: ["forward-route"],
      matched_policy_ids: [],
      matched_nat_rule_ids: ["snat-egress"],
    },
    return_path: {
      path: ["dst-if"],
      status: "no_route",
      matched_route_ids: ["return-route"],
      matched_policy_ids: [],
      matched_nat_rule_ids: [],
    },
  });
  const diagnosis = diagnoseRoute({ nodes: [], interfaces: [], links: [] }, response, baseIntent());

  assert.equal(diagnosis.designIssue.category, "RETURN_PATH_GAP");
  assert.equal(diagnosis.designIssue.headline, "往復通信として未成立");
});

test("diagnoseRoute uses NAT return assumption only when return failure lacks concrete route/policy evidence", () => {
  const response = okResponse({
    status: "no_route",
    forward: {
      path: ["src-if", "mid-if", "dst-if"],
      status: "reachable",
      matched_route_ids: ["forward-route"],
      matched_policy_ids: [],
      matched_nat_rule_ids: ["snat-egress"],
    },
    return_path: {
      path: ["dst-if"],
      status: "no_route",
      matched_route_ids: [],
      matched_policy_ids: [],
      matched_nat_rule_ids: [],
    },
  });
  const diagnosis = diagnoseRoute({ nodes: [], interfaces: [], links: [] }, response, baseIntent());

  assert.equal(diagnosis.designIssue.category, "NAT_RETURN_ASSUMPTION");
  assert.equal(diagnosis.designIssue.headline, "往復通信として未成立");
});
