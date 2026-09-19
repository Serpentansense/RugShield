import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Logo } from '@/components/logo';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'RugShield — Solana token security checks for AI trading agents',
  description:
    'Send a Solana mint address, get a risk score, risk level and the on-chain evidence behind it. Available over HTTP and MCP.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <header className="border-b border-edge/70 bg-surface/40 backdrop-blur">
          <nav
            aria-label="Main"
            className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4"
          >
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-md text-foreground"
            >
              <Logo className="h-7 w-7" />
              <span className="text-lg font-semibold tracking-tight">RugShield</span>
            </Link>
            <div className="flex items-center gap-1 text-sm">
              <Link
                href="/"
                className="rounded-md px-3 py-1.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                Scan
              </Link>
              <Link
                href="/track-record"
                className="rounded-md px-3 py-1.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                Track record
              </Link>
            </div>
          </nav>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-edge/70 px-5 py-6">
          <p className="mx-auto max-w-5xl text-xs leading-relaxed text-muted">
            RugShield reports observable on-chain and market signals. A low score is not a
            guarantee that a token is safe, and a high score is not proof of fraud. Always
            review the evidence yourself before trading.
          </p>
        </footer>
      </body>
    </html>
  );
}
