import { describe, expect, it } from 'vitest';
import type { PaymentPayload, SettleResponse, VerifyResponse } from '@x402/core/types';
import { toAtomic, validateX402Config, type X402Config } from './config';
import { FacilitatorRequestError, type FacilitatorClient } from './facilitator';
import { PAYMENT_HEADER, buildPaymentRequirements, runPaymentGate } from './gate';

const RESOURCE = {
  url: 'https://rugshield.test/api/check',
  description: 'scan',
  mimeType: 'application/json',
};

function config(overrides: Partial<X402Config> = {}): X402Config {
  return {
    enabled: true,
    network: 'solana:devnet',
    payTo: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    assetDecimals: 6,
    priceUsdc: '0.01',
    amountAtomic: '10000',
    facilitatorUrl: 'https://facilitator.test',
    facilitatorApiKey: null,
    maxTimeoutSeconds: 120,
    x402Version: 2,
    ...overrides,
  };
}

function header(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

const VALID_PAYLOAD = {
  x402Version: 2,
  accepted: buildPaymentRequirements(config()),
  payload: { signature: 'sig' },
};

function headers(map: Record<string, string> = {}) {
  return (name: string) => map[name.toLowerCase()] ?? null;
}

class FakeFacilitator implements FacilitatorClient {
  verifyCalls: PaymentPayload[] = [];
  settleCalls: PaymentPayload[] = [];

  constructor(
    private readonly verifyResult: VerifyResponse | Error,
    private readonly settleResult: SettleResponse | Error = {
      success: true,
      transaction: 'tx-signature',
      network: 'solana:devnet',
      payer: 'payer-address',
    },
  ) {}

  async verify(p: PaymentPayload): Promise<VerifyResponse> {
    this.verifyCalls.push(p);
    if (this.verifyResult instanceof Error) throw this.verifyResult;
    return this.verifyResult;
  }

  async settle(p: PaymentPayload): Promise<SettleResponse> {
    this.settleCalls.push(p);
    if (this.settleResult instanceof Error) throw this.settleResult;
    return this.settleResult;
  }
}

describe('toAtomic', () => {
  it('converts human amounts without float drift', () => {
    expect(toAtomic('0.01', 6)).toBe('10000');
    expect(toAtomic('1', 6)).toBe('1000000');
    expect(toAtomic('0.000001', 6)).toBe('1');
    expect(toAtomic('12.345678', 6)).toBe('12345678');
  });

  it('truncates beyond the asset precision', () => {
    expect(toAtomic('0.0000001', 6)).toBe('0');
    expect(toAtomic('1.9999999', 6)).toBe('1999999');
  });

  it('handles a zero decimal asset', () => {
    expect(toAtomic('5', 0)).toBe('5');
  });
});

describe('validateX402Config', () => {
  it('reports nothing while payment is disabled', () => {
    expect(validateX402Config(config({ enabled: false, payTo: null }))).toEqual([]);
  });

  it('requires a payee and a facilitator once enabled', () => {
    const problems = validateX402Config(
      config({ payTo: null, facilitatorUrl: null }),
    );
    expect(problems).toContain('X402_PAY_TO is not set');
    expect(problems).toContain('X402_FACILITATOR_URL is not set');
  });

  it('rejects a price that resolves to zero', () => {
    const problems = validateX402Config(config({ priceUsdc: '0', amountAtomic: '0' }));
    expect(problems.some((p) => p.includes('positive amount'))).toBe(true);
  });
});

describe('buildPaymentRequirements', () => {
  it('advertises the exact scheme with atomic amount and a human mirror', () => {
    const requirements = buildPaymentRequirements(config());
    expect(requirements).toMatchObject({
      scheme: 'exact',
      network: 'solana:devnet',
      amount: '10000',
      maxTimeoutSeconds: 120,
    });
    expect(requirements.extra).toMatchObject({ humanAmount: '0.01', assetSymbol: 'USDC' });
  });
});

describe('runPaymentGate', () => {
  it('serves for free when payment is disabled', async () => {
    const decision = await runPaymentGate(headers(), RESOURCE, {
      config: config({ enabled: false }),
    });
    expect(decision.kind).toBe('free');
  });

  it('fails closed when enabled but misconfigured', async () => {
    // Must never silently fall back to free when the operator meant to charge.
    const decision = await runPaymentGate(headers(), RESOURCE, {
      config: config({ payTo: null }),
    });
    expect(decision.kind).toBe('misconfigured');
    if (decision.kind !== 'misconfigured') throw new Error('unreachable');
    expect(decision.problems).toContain('X402_PAY_TO is not set');
  });

  it('asks for payment when no header is present', async () => {
    const decision = await runPaymentGate(headers(), RESOURCE, { config: config() });
    expect(decision.kind).toBe('payment_required');
    if (decision.kind !== 'payment_required') throw new Error('unreachable');
    expect(decision.body.x402Version).toBe(2);
    expect(decision.body.accepts).toHaveLength(1);
    expect(decision.body.resource).toMatchObject({ url: RESOURCE.url });
    expect(decision.body.error).toBeUndefined();
  });

  it('rejects a header that is not base64 JSON', async () => {
    const decision = await runPaymentGate(
      headers({ [PAYMENT_HEADER]: 'nonsense!!' }),
      RESOURCE,
      { config: config() },
    );
    expect(decision.kind).toBe('payment_required');
    if (decision.kind !== 'payment_required') throw new Error('unreachable');
    expect(decision.body.error).toMatch(/base64-encoded JSON/i);
  });

  it('rejects base64 JSON that is not a payment payload', async () => {
    const decision = await runPaymentGate(
      headers({ [PAYMENT_HEADER]: header({ hello: 'world' }) }),
      RESOURCE,
      { config: config() },
    );
    expect(decision.kind).toBe('payment_required');
  });

  it('asks again when verification says the payment is invalid', async () => {
    const facilitator = new FakeFacilitator({
      isValid: false,
      invalidReason: 'insufficient_funds',
      invalidMessage: 'balance too low',
    });
    const decision = await runPaymentGate(
      headers({ [PAYMENT_HEADER]: header(VALID_PAYLOAD) }),
      RESOURCE,
      { config: config(), facilitator },
    );

    expect(decision.kind).toBe('payment_required');
    if (decision.kind !== 'payment_required') throw new Error('unreachable');
    expect(decision.body.error).toMatch(/insufficient_funds/);
    expect(facilitator.settleCalls).toHaveLength(0);
  });

  it('asks again when settlement fails', async () => {
    const facilitator = new FakeFacilitator(
      { isValid: true, payer: 'payer' },
      { success: false, errorReason: 'tx_failed', transaction: '', network: 'solana:devnet' },
    );
    const decision = await runPaymentGate(
      headers({ [PAYMENT_HEADER]: header(VALID_PAYLOAD) }),
      RESOURCE,
      { config: config(), facilitator },
    );
    expect(decision.kind).toBe('payment_required');
    if (decision.kind !== 'payment_required') throw new Error('unreachable');
    expect(decision.body.error).toMatch(/tx_failed/);
  });

  it('does not serve the resource when the facilitator is unreachable', async () => {
    // The critical property: an unreachable facilitator must not become free access.
    const facilitator = new FakeFacilitator(
      new FacilitatorRequestError('Facilitator verify request failed: fetch failed', 'verify'),
    );
    const decision = await runPaymentGate(
      headers({ [PAYMENT_HEADER]: header(VALID_PAYLOAD) }),
      RESOURCE,
      { config: config(), facilitator },
    );
    expect(decision.kind).toBe('payment_required');
    if (decision.kind !== 'payment_required') throw new Error('unreachable');
    expect(decision.body.error).toMatch(/fetch failed/);
  });

  it('allows access and returns a receipt once settled', async () => {
    const facilitator = new FakeFacilitator({ isValid: true, payer: 'payer-address' });
    const decision = await runPaymentGate(
      headers({ [PAYMENT_HEADER]: header(VALID_PAYLOAD) }),
      RESOURCE,
      { config: config(), facilitator },
    );

    expect(decision.kind).toBe('paid');
    if (decision.kind !== 'paid') throw new Error('unreachable');
    expect(decision.transaction).toBe('tx-signature');
    expect(decision.payer).toBe('payer-address');

    const receipt = JSON.parse(Buffer.from(decision.receiptHeader, 'base64').toString('utf8'));
    expect(receipt).toMatchObject({ success: true, transaction: 'tx-signature' });
    expect(facilitator.verifyCalls).toHaveLength(1);
    expect(facilitator.settleCalls).toHaveLength(1);
  });

  it('verifies before settling', async () => {
    const order: string[] = [];
    const facilitator: FacilitatorClient = {
      async verify() {
        order.push('verify');
        return { isValid: true };
      },
      async settle() {
        order.push('settle');
        return { success: true, transaction: 'tx', network: 'solana:devnet' };
      },
    };
    await runPaymentGate(headers({ [PAYMENT_HEADER]: header(VALID_PAYLOAD) }), RESOURCE, {
      config: config(),
      facilitator,
    });
    expect(order).toEqual(['verify', 'settle']);
  });

  it('looks the header up case-insensitively', async () => {
    const facilitator = new FakeFacilitator({ isValid: true });
    const decision = await runPaymentGate(
      (name) => (name.toLowerCase() === 'x-payment' ? header(VALID_PAYLOAD) : null),
      RESOURCE,
      { config: config(), facilitator },
    );
    expect(decision.kind).toBe('paid');
  });
});
