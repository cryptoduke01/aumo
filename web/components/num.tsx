"use client";

import NumberFlow from "@number-flow/react";

// Live numbers that animate between values as fresh data arrives. Rendered in the
// brand font (tabular figures for alignment), never mono. `currency` formats as
// USD, which is sensible for a dollar stablecoin.
export function Num({
  value,
  prefix,
  suffix,
  currency,
  maximumFractionDigits = 2,
  minimumFractionDigits,
  className = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  currency?: boolean;
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
  className?: string;
}) {
  return (
    <NumberFlow
      value={value}
      prefix={prefix}
      suffix={suffix}
      format={
        currency
          ? { style: "currency", currency: "USD", maximumFractionDigits, minimumFractionDigits }
          : { maximumFractionDigits, minimumFractionDigits }
      }
      className={`tnum ${className}`}
      willChange
    />
  );
}
