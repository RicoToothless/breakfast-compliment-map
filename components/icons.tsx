export function PinIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
export function LocationIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 1v4m0 14v4M1 12h4m14 0h4" />
    </svg>
  );
}
export function SparkIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" />
    </svg>
  );
}
export function SunLogo({ size = 44 }: { size?: number }) {
  return (
    <svg className="sun-logo" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <rect className="sun-rays" width="100" height="100" />
      <circle cx="50" cy="50" r="28.7" fill="var(--sun-center)" />
      <rect x="37.8" y="42.7" width="3.5" height="6.3" rx="1.75" fill="#5d542b" />
      <rect x="58.1" y="42.7" width="3.5" height="6.3" rx="1.75" fill="#5d542b" />
      <path
        d="M43.4 54c0 8 14.7 8 14.7 0"
        fill="none"
        stroke="#5d542b"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
