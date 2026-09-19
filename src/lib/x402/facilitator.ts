/**
 * Facilitator client: the component that actually checks a signed payment and
 * submits it on-chain. RugShield never touches a private key — it only asks a
 * facilitator to verify and settle.
 *
 * `FacilitatorClient` is an interface so the gate can be tested with a fake.
 */

import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '@x402/core/types';
import type { X402Config } from './config';

export interface FacilitatorClient {
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse>;
  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse>;
}

export class FacilitatorRequestError extends Error {
  constructor(
    message: string,
    readonly path: 'verify' | 'settle',
  ) {
    super(message);
    this.name = 'FacilitatorRequestError';
  }
}

/** Talks the x402 facilitator HTTP API over plain fetch. */
export class HttpFacilitatorClient implements FacilitatorClient {
  constructor(private readonly config: X402Config) {}

  verify(payload: PaymentPayload, requirements: PaymentRequirements) {
    return this.post<VerifyResponse>('verify', payload, requirements);
  }

  settle(payload: PaymentPayload, requirements: PaymentRequirements) {
    return this.post<SettleResponse>('settle', payload, requirements);
  }

  private async post<T>(
    path: 'verify' | 'settle',
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<T> {
    if (!this.config.facilitatorUrl) {
      throw new FacilitatorRequestError('No facilitator URL configured', path);
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (this.config.facilitatorApiKey) {
      headers.authorization = `Bearer ${this.config.facilitatorApiKey}`;
    }

    let res: Response;
    try {
      res = await fetch(`${this.config.facilitatorUrl}/${path}`, {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify({
          x402Version: this.config.x402Version,
          paymentPayload,
          paymentRequirements,
        }),
        signal: AbortSignal.timeout(this.config.maxTimeoutSeconds * 1000),
      });
    } catch (err) {
      throw new FacilitatorRequestError(
        `Facilitator ${path} request failed: ${err instanceof Error ? err.message : String(err)}`,
        path,
      );
    }

    const text = await res.text();
    if (!res.ok) {
      throw new FacilitatorRequestError(
        `Facilitator ${path} returned HTTP ${res.status}: ${text.slice(0, 300)}`,
        path,
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new FacilitatorRequestError(
        `Facilitator ${path} returned a non-JSON body`,
        path,
      );
    }
  }
}
