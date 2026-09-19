/**
 * The payment gate.
 *
 * Framework-agnostic on purpose: it takes a header lookup and returns a
 * decision, so it can be unit-tested with no HTTP server and dropped into any
 * route handler.
 *
 * Protocol flow implemented here:
 *   1. no `X-PAYMENT` header  -> 402 with a `PaymentRequired` body
 *   2. header present         -> facilitator `/verify`
 *   3. verify ok              -> facilitator `/settle`
 *   4. settle ok              -> allow, and return an `X-PAYMENT-RESPONSE` receipt
 */

import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
} from '@x402/core/types';
import { getX402Config, validateX402Config, type X402Config } from './config';
import {
  FacilitatorRequestError,
  HttpFacilitatorClient,
  type FacilitatorClient,
} from './facilitator';

export const PAYMENT_HEADER = 'x-payment';
export const PAYMENT_RESPONSE_HEADER = 'x-payment-response';

export type GateDecision =
  /** Payment is disabled; serve the resource for free. */
  | { kind: 'free' }
  /** Payment settled. Attach `receiptHeader` to the success response. */
  | { kind: 'paid'; payer: string | null; transaction: string; receiptHeader: string }
  /** Respond 402 with `body`. */
  | { kind: 'payment_required'; body: PaymentRequired }
  /** Operator error: enabled but not configured. Respond 500. */
  | { kind: 'misconfigured'; problems: string[] };

export interface ResourceDescriptor {
  /** Absolute URL of the protected resource. */
  url: string;
  description: string;
  mimeType: string;
}

export interface GateOptions {
  config?: X402Config;
  facilitator?: FacilitatorClient;
}

/** Builds the `accepts` entry advertised in the 402 response. */
export function buildPaymentRequirements(config: X402Config): PaymentRequirements {
  return {
    scheme: 'exact',
    network: config.network,
    asset: config.asset,
    amount: config.amountAtomic,
    payTo: config.payTo ?? '',
    maxTimeoutSeconds: config.maxTimeoutSeconds,
    extra: {
      // Human-readable mirror of `amount`, handy when debugging a 402.
      humanAmount: config.priceUsdc,
      assetSymbol: 'USDC',
      assetDecimals: config.assetDecimals,
    },
  };
}

function buildPaymentRequired(
  config: X402Config,
  resource: ResourceDescriptor,
  error?: string,
): PaymentRequired {
  return {
    x402Version: config.x402Version,
    ...(error ? { error } : {}),
    resource: {
      url: resource.url,
      description: resource.description,
      mimeType: resource.mimeType,
      serviceName: 'RugShield',
      tags: ['solana', 'security', 'token-risk'],
    },
    accepts: [buildPaymentRequirements(config)],
  };
}

function decodePaymentHeader(raw: string): PaymentPayload | null {
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && 'x402Version' in parsed) {
      return parsed as PaymentPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Runs the gate for one request.
 *
 * @param getHeader case-insensitive header lookup from the incoming request
 * @param resource  what is being paid for, advertised in the 402 body
 */
export async function runPaymentGate(
  getHeader: (name: string) => string | null,
  resource: ResourceDescriptor,
  options: GateOptions = {},
): Promise<GateDecision> {
  const config = options.config ?? getX402Config();

  if (!config.enabled) return { kind: 'free' };

  const problems = validateX402Config(config);
  if (problems.length > 0) {
    // Fail closed. Never fall back to serving for free when the operator
    // intended to charge.
    return { kind: 'misconfigured', problems };
  }

  const header = getHeader(PAYMENT_HEADER);
  if (!header) {
    return { kind: 'payment_required', body: buildPaymentRequired(config, resource) };
  }

  const payload = decodePaymentHeader(header);
  if (!payload) {
    return {
      kind: 'payment_required',
      body: buildPaymentRequired(
        config,
        resource,
        'The X-PAYMENT header was not base64-encoded JSON matching the x402 payment payload shape.',
      ),
    };
  }

  const requirements = buildPaymentRequirements(config);
  const facilitator = options.facilitator ?? new HttpFacilitatorClient(config);

  try {
    const verification = await facilitator.verify(payload, requirements);
    if (!verification.isValid) {
      return {
        kind: 'payment_required',
        body: buildPaymentRequired(
          config,
          resource,
          `Payment verification failed: ${verification.invalidReason ?? 'unknown reason'}${
            verification.invalidMessage ? ` (${verification.invalidMessage})` : ''
          }`,
        ),
      };
    }

    const settlement = await facilitator.settle(payload, requirements);
    if (!settlement.success) {
      return {
        kind: 'payment_required',
        body: buildPaymentRequired(
          config,
          resource,
          `Payment settlement failed: ${settlement.errorReason ?? 'unknown reason'}${
            settlement.errorMessage ? ` (${settlement.errorMessage})` : ''
          }`,
        ),
      };
    }

    return {
      kind: 'paid',
      payer: settlement.payer ?? verification.payer ?? null,
      transaction: settlement.transaction,
      receiptHeader: Buffer.from(JSON.stringify(settlement), 'utf8').toString('base64'),
    };
  } catch (err) {
    const message =
      err instanceof FacilitatorRequestError
        ? err.message
        : `Unexpected facilitator error: ${err instanceof Error ? err.message : String(err)}`;
    // The facilitator is unreachable, so we cannot confirm payment. Ask again
    // rather than serving the resource unpaid.
    return {
      kind: 'payment_required',
      body: buildPaymentRequired(config, resource, message),
    };
  }
}
