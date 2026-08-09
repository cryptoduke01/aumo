"use client";

import NumberFlow from "@number-flow/react";

// Live financial numbers that animate between values as fresh data arrives.
// Motion tied to real data, not decoration. Tabular by default.
export function Num({
  value,
  prefix,
  suffix,
  maximumFractionDigits = 2,
  minimumFractionDigits,
  className = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
  className?: string;
}) {
  return (
    <NumberFlow
      value={value}
      prefix={prefix}
      suffix={suffix}
      format={{ maximumFractionDigits, minimumFractionDigits }}
      className={`tnum ${className}`}
      willChange
    />
  );
}
