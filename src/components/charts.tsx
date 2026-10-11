"use client";

import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

type Format = "money" | "number";

function formatter(format: Format, currency: string, compact = false) {
  const nf =
    format === "money"
      ? new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency,
          maximumFractionDigits: compact ? 1 : 0,
          notation: compact ? "compact" : "standard",
        })
      : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1, notation: compact ? "compact" : "standard" });
  return (v: unknown) => nf.format(Number(v ?? 0));
}

const axis = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--ink)",
  },
  labelStyle: { color: "var(--ink)", fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: "var(--ink-2)", padding: 0 },
  cursor: { fill: "var(--surface-2)" },
};

/** Revenue vs expenses per month: two series, one shared axis. */
export function RevenueExpenseChart({
  data,
  currency,
}: {
  data: { month: string; revenue: number; expenses: number }[];
  currency: string;
}) {
  const fmt = formatter("money", currency);
  const fmtAxis = formatter("money", currency, true);
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="month" {...axis} />
          <YAxis {...axis} width={64} tickFormatter={fmtAxis} />
          <Tooltip {...tooltipStyle} formatter={(v) => fmt(v)} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: "var(--ink-2)" }} />
          <Bar dataKey="revenue" name="Revenue" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expenses" name="Expenses" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One series of bars. Horizontal layout suits category breakdowns with long labels. */
export function SimpleBarChart({
  data,
  name,
  format = "number",
  currency = "INR",
  horizontal,
  height = 260,
}: {
  data: { label: string; value: number }[];
  name: string;
  format?: Format;
  currency?: string;
  horizontal?: boolean;
  height?: number;
}) {
  const fmt = formatter(format, currency);
  const fmtAxis = formatter(format, currency, true);
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer>
        {horizontal ? (
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid horizontal={false} stroke="var(--line)" />
            <XAxis type="number" {...axis} tickFormatter={fmtAxis} />
            <YAxis type="category" dataKey="label" {...axis} width={110} />
            <Tooltip {...tooltipStyle} formatter={(v) => [fmt(v), name]} />
            <Bar dataKey="value" name={name} fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={22} />
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
            <YAxis {...axis} width={48} tickFormatter={fmtAxis} allowDecimals={false} />
            <Tooltip {...tooltipStyle} formatter={(v) => [fmt(v), name]} />
            <Bar dataKey="value" name={name} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** A single trend line (e.g. body weight over time). */
export function TrendLine({ data, name, unit }: { data: { label: string; value: number }[]; name: string; unit?: string }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={44} domain={["dataMin - 2", "dataMax + 2"]} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
            formatter={(v) => [`${v}${unit ?? ""}`, name]}
          />
          <Line
            type="monotone"
            dataKey="value"
            name={name}
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={{ r: 4, fill: "var(--series-1)", stroke: "var(--surface)", strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
