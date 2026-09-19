/** Shield mark used in the header and the hero. Decorative only. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 2.5 4.5 5.4v6.2c0 4.6 3.1 8.4 7.5 9.9 4.4-1.5 7.5-5.3 7.5-9.9V5.4L12 2.5Z"
        fill="url(#rs-shield)"
        stroke="var(--accent)"
        strokeWidth="1.1"
      />
      <path
        d="m8.6 12.2 2.5 2.5 4.4-4.9"
        fill="none"
        stroke="#07090d"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="rs-shield" x1="4.5" y1="2.5" x2="19.5" y2="21.5">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
    </svg>
  );
}
