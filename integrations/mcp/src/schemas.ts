import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { ASSET_DECIMALS } from "./config.js";
import { parseAssetAmount } from "./tx.js";

// Zod input schemas for every tool. Exported as raw shapes (what McpServer.registerTool takes) and
// as objects (for tests). Validation lives here so a bad argument is rejected before any network
// call, and every address is normalized to its checksum form.

export const addressSchema = z
  .string()
  .trim()
  .refine((s) => isAddress(s), {
    message: "Not a valid EVM address (0x + 40 hex chars; mixed-case input must be a valid checksum).",
  })
  .transform((s) => getAddress(s) as Address);

const numberish = z.union([z.string(), z.number()]).transform((v) => String(v).trim());

export const amountSchema = numberish
  .transform((s, ctx) => {
    try {
      return parseAssetAmount(s);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : String(e) });
      return z.NEVER;
    }
  })
  .describe(`USDT0 amount as a decimal string, e.g. "25" or "25.5" (max ${ASSET_DECIMALS} decimals).`);

export const withdrawAmountSchema = numberish
  .transform((s, ctx): bigint | "max" => {
    if (/^(max|all)$/i.test(s)) return "max";
    try {
      return parseAssetAmount(s);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : String(e) });
      return z.NEVER;
    }
  })
  .describe(`USDT0 amount as a decimal string like "25.5", or "max" to exit the whole position.`);

export const takenAtSchema = z
  .string()
  .trim()
  .refine((s) => Number.isFinite(Date.parse(s)), { message: "takenAt must be an ISO 8601 timestamp." });

export const statusShape = {};
export const venuesShape = {};

export const decisionsShape = {
  limit: z.number().int().min(1).max(50).default(10).describe("How many decisions to return, newest first (1 to 50)."),
  filter: z
    .enum(["all", "moved", "held"])
    .default("all")
    .describe('"moved" = decisions that rebalanced funds, "held" = decisions that kept the allocation, "all" = both.'),
};

export const replayShape = {
  takenAt: takenAtSchema
    .optional()
    .describe("The decision's takenAt timestamp, exactly as returned by aumo_decisions. Omit for the latest decision."),
};

export const askShape = {
  question: z.string().trim().min(1).max(500).describe("A plain-language question for the Aumo agent (max 500 chars)."),
  address: addressSchema
    .optional()
    .describe("Optional wallet address. When given, the agent answers with that wallet's live pool position."),
};

export const positionShape = {
  address: addressSchema.describe("The wallet address to look up."),
};

export const prepareDepositShape = {
  from: addressSchema.describe("The wallet that holds the USDT0 and will sign and send the transactions."),
  amount: amountSchema,
  receiver: addressSchema.optional().describe("Who receives the pool shares. Defaults to `from`."),
};

export const prepareWithdrawShape = {
  owner: addressSchema.describe("The wallet that holds the pool shares and will sign and send the transaction."),
  amount: withdrawAmountSchema,
  receiver: addressSchema.optional().describe("Who receives the USDT0. Defaults to `owner`."),
};

export const schemas = {
  decisions: z.object(decisionsShape),
  replay: z.object(replayShape),
  ask: z.object(askShape),
  position: z.object(positionShape),
  prepareDeposit: z.object(prepareDepositShape),
  prepareWithdraw: z.object(prepareWithdrawShape),
};
