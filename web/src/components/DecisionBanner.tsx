import {
  actualReachabilityLabel,
  causeCodeLabel,
  causeTone,
  designIssueTone,
  evaluationTone,
  factLabel,
  factTone,
  type RouteDiagnosis,
} from "../diagnosis";
import { Badge, buttonClass, cn } from "./common";

type DecisionBannerProps = {
  diagnosis: RouteDiagnosis;
  source: string;
  destination: string;
  protocol: string;
  sourceLabel: string;
  onJump: () => void;
};

export function DecisionBanner({
  diagnosis,
  source,
  destination,
  protocol,
  sourceLabel,
  onJump,
}: DecisionBannerProps) {
  const actualReachability = actualReachabilityLabel(diagnosis);
  const jumpAvailable = diagnosis.remediation.target.type !== "none";

  return (
    <div className={cn(
      "grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]",
      diagnosis.evaluation.result === "PASS" && "bg-teal-50/70",
      diagnosis.evaluation.result === "FAIL" && "bg-red-50/80",
      diagnosis.evaluation.result === "PENDING" && "bg-zinc-50",
      diagnosis.evaluation.result === "ERROR" && "bg-red-50/80"
    )}>
      <div className="min-w-0 rounded-md border border-zinc-200 bg-white p-3">
        <div className="text-xs font-semibold uppercase text-zinc-500">実通信</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={factTone(diagnosis.facts.e2e)}>{actualReachability}</Badge>
          <span className="text-xs font-semibold text-zinc-500">actual reachability</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone={factTone(diagnosis.facts.e2e)}>E2E {factLabel(diagnosis.facts.e2e)}</Badge>
          <Badge tone={factTone(diagnosis.facts.forward)}>FWD {factLabel(diagnosis.facts.forward)}</Badge>
          <Badge tone={factTone(diagnosis.facts.reverse)}>REV {factLabel(diagnosis.facts.reverse)}</Badge>
        </div>
        <div className="mt-2 break-words font-mono text-sm font-semibold text-zinc-900">
          {source} {"->"} {destination} / {protocol}
        </div>
      </div>
      <div className="min-w-0 rounded-md border border-zinc-200 bg-white p-3">
        <div className="text-xs font-semibold uppercase text-zinc-500">設計評価</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone={evaluationTone(diagnosis.evaluation.result)}>{diagnosis.evaluation.result}</Badge>
          <Badge tone={diagnosis.evaluation.expectedReachable ? "success" : "danger"}>
            期待 {diagnosis.evaluation.expectedReachable ? "到達可能" : "到達不可"}
          </Badge>
          <Badge tone={designIssueTone(diagnosis.designIssue.severity)}>{diagnosis.designIssue.severity}</Badge>
        </div>
        <div className="mt-2 text-sm font-semibold text-zinc-950">{diagnosis.designIssue.headline}</div>
        <div className="mt-1 text-sm text-zinc-700">{diagnosis.designIssue.summary}</div>
        <div className="mt-3 grid gap-1 text-xs">
          <div className="grid gap-1 sm:grid-cols-[5rem_minmax(0,1fr)]">
            <span className="font-semibold uppercase text-zinc-500">意図</span>
            <span className="min-w-0 break-words text-zinc-700">{diagnosis.intentRealityGap.intentLabel}</span>
          </div>
          <div className="grid gap-1 sm:grid-cols-[5rem_minmax(0,1fr)]">
            <span className="font-semibold uppercase text-zinc-500">実際</span>
            <span className="min-w-0 break-words text-zinc-700">{diagnosis.intentRealityGap.realityLabel}</span>
          </div>
          <div className="grid gap-1 sm:grid-cols-[5rem_minmax(0,1fr)]">
            <span className="font-semibold uppercase text-zinc-500">要件</span>
            <span className="min-w-0 break-words text-zinc-700">{sourceLabel}</span>
          </div>
        </div>
        <div className="mt-3 text-xs font-semibold uppercase text-zinc-500">改善案</div>
        <div className="mt-1 text-sm font-semibold text-zinc-950">{diagnosis.designAdvice.summary}</div>
        <ul className="mt-2 grid gap-1 text-xs text-zinc-600">
          {diagnosis.designAdvice.actions.map((action) => (
            <li key={action}>- {action}</li>
          ))}
        </ul>
        {jumpAvailable ? (
          <button className={cn(buttonClass("secondary"), "mt-3")} type="button" onClick={onJump}>
            該当箇所を開く
          </button>
        ) : null}
      </div>
      <div className="min-w-0 rounded-md border border-zinc-200 bg-white p-3">
        <div className="text-xs font-semibold uppercase text-zinc-500">技術詳細</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone={causeTone(diagnosis.cause.code, diagnosis.evaluation.result)}>Technical Cause: {causeCodeLabel(diagnosis.cause.code)}</Badge>
          <Badge tone="muted">{diagnosis.cause.leg}</Badge>
          <Badge tone="muted">{diagnosis.remediation.confidence}</Badge>
        </div>
        <div className="mt-2 text-sm font-semibold text-zinc-950">{diagnosis.cause.message}</div>
        <EvidenceList
          evidence={diagnosis.cause.evidence}
          emphasize={diagnosis.evaluation.result !== "PASS"}
        />
      </div>
    </div>
  );
}

function EvidenceList({
  evidence,
  emphasize,
}: {
  evidence: RouteDiagnosis["cause"]["evidence"];
  emphasize: boolean;
}) {
  const items = [
    {
      label: "routes",
      value: evidence.routes.length ? evidence.routes.join(" -> ") : "なし",
      primary: evidence.primaryCause === "route",
    },
    {
      label: "policy",
      value: evidence.policies.length ? evidence.policies.join(" -> ") : "なし",
      primary: evidence.primaryCause === "policy",
    },
    {
      label: "NAT",
      value: evidence.natRules.length ? evidence.natRules.join(" -> ") : "なし",
      primary: evidence.primaryCause === "nat",
    },
  ];

  return (
    <div className="mt-2 grid gap-1 text-xs">
      {items.map((item) => (
        <div className="grid gap-1 sm:grid-cols-[4rem_minmax(0,1fr)]" key={item.label}>
          <span className={cn("font-semibold uppercase", item.primary && emphasize ? "text-red-700" : "text-zinc-500")}>{item.label}</span>
          <span className={cn("min-w-0 break-words font-mono", item.primary && emphasize ? "font-semibold text-red-800" : "text-zinc-700")}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}
