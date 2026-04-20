import { useEffect, useMemo, useState, type ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { GraphModel } from "../types";

export function Metric({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  tone?: "default" | "warn";
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className={cn("mb-3 flex h-9 w-9 items-center justify-center rounded-md", tone === "warn" ? "bg-yellow-50 text-yellow-700" : "bg-teal-50 text-teal-700")}>
        {icon}
      </div>
      <div className="text-2xl font-semibold text-zinc-950">{value}</div>
      <div className="text-sm text-zinc-500">{label}</div>
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-lg border border-zinc-200 bg-white shadow-sm", className)}>{children}</section>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EndpointSummary({
  graph,
  label,
  interfaceId,
}: {
  graph: GraphModel;
  label: string;
  interfaceId: string;
}) {
  const interfaceItem = graph.interfaces.find((item) => item.id === interfaceId);
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
      <div className="text-xs font-semibold text-zinc-500">{label}</div>
      <div className="mt-1 break-all font-mono text-xs font-semibold text-zinc-900">
        {interfaceId}
      </div>
      {interfaceItem?.ip_address ? (
        <div className="mt-1 break-all font-mono text-xs text-zinc-500">
          {interfaceItem.ip_address}
        </div>
      ) : null}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
      {label}
      {children}
    </label>
  );
}

export type EndpointOption = {
  interfaceId: string;
  ip: string;
  label: string;
};

export function SearchableEndpointSelect({
  value,
  options,
  placeholder = "IPまたはノード名で検索",
  onChange,
}: {
  value: string;
  options: EndpointOption[];
  placeholder?: string;
  onChange: (ip: string) => void;
}) {
  const selectedOption = options.find((option) => option.ip === value);
  const optionKey = useMemo(
    () => options.map((option) => `${option.interfaceId}:${option.ip}`).join("|"),
    [options]
  );
  const [query, setQuery] = useState(selectedOption?.label ?? value);
  const [open, setOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(
    () =>
      options
        .filter((option) =>
          !normalizedQuery ||
          option.ip.toLowerCase().includes(normalizedQuery) ||
          option.label.toLowerCase().includes(normalizedQuery)
        )
        .slice(0, 30),
    [normalizedQuery, options]
  );

  useEffect(() => {
    setQuery(selectedOption?.label ?? value);
  }, [optionKey, selectedOption?.label, value]);

  function selectOption(option: EndpointOption) {
    onChange(option.ip);
    setQuery(option.label);
    setOpen(false);
  }

  function resetQuery() {
    setQuery(selectedOption?.label ?? value);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        className={inputClass}
        placeholder={placeholder}
        value={query}
        onBlur={resetQuery}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          setOpen(true);
          const exactOption = options.find((option) => option.ip === nextQuery.trim());
          if (exactOption) {
            onChange(exactOption.ip);
          }
        }}
        onFocus={() => setOpen(true)}
      />
      {open ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg">
          {filteredOptions.length ? (
            filteredOptions.map((option) => (
              <button
                className="block w-full rounded px-2 py-2 text-left text-xs hover:bg-zinc-100"
                key={option.interfaceId}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOption(option);
                }}
              >
                <span className="font-mono font-semibold text-zinc-950">{option.ip}</span>
                <span className="ml-2 text-zinc-500">{option.label.replace(option.ip, "").trim()}</span>
              </button>
            ))
          ) : (
            <div className="px-2 py-2 text-xs text-zinc-500">一致するIPはありません。</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function EmptyMessage({ children }: { children: ReactNode }) {
  return <p className="m-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">{children}</p>;
}

export function ToolbarSeparator() {
  return <span aria-hidden="true" className="mx-1 flex min-h-9 items-center text-zinc-300">|</span>;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[88vh] w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
          <button className={buttonClass("secondary")} type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="max-h-[calc(88vh-64px)] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "muted" | "danger" | "warn";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1",
        tone === "success" && "bg-teal-50 text-teal-700 ring-teal-200",
        tone === "muted" && "bg-zinc-100 text-zinc-600 ring-zinc-200",
        tone === "danger" && "bg-red-50 text-red-700 ring-red-200",
        tone === "warn" && "bg-yellow-50 text-yellow-800 ring-yellow-200",
        tone === "default" && "bg-zinc-50 text-zinc-700 ring-zinc-200"
      )}
    >
      {children}
    </span>
  );
}

export function buttonClass(variant: "primary" | "secondary" | "success" | "danger" = "primary") {
  return cn(
    "inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-teal-200",
    variant === "primary" && "bg-teal-700 text-white hover:bg-teal-800",
    variant === "secondary" && "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
    variant === "success" && "bg-teal-50 text-teal-700 ring-1 ring-teal-200 hover:bg-teal-100",
    variant === "danger" && "bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100"
  );
}

export const inputClass =
  "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
