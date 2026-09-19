import { BuiltForAgents } from '@/components/built-for-agents';
import { Logo } from '@/components/logo';
import { ScanForm } from '@/components/scan-form';

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-12 sm:py-16">
      <section className="text-center">
        <Logo className="mx-auto h-12 w-12" />
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">RugShield</h1>
        <p className="mt-2 text-base text-muted">Security checks for AI trading agents</p>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted">
          Paste a Solana token mint address. RugShield reads the mint account, its
          authorities and extensions, finds the liquidity pools, and quotes a buy/sell
          round trip — then shows the score and the evidence behind it.
        </p>
      </section>

      <div className="mt-10">
        <ScanForm />
      </div>

      <div className="mt-14">
        <BuiltForAgents />
      </div>
    </div>
  );
}
