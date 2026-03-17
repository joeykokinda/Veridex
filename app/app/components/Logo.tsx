export function Logo({ size = 20 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 60 60"
        width={size}
        height={size}
        style={{ flexShrink: 0 }}
      >
        <path
          d="M30,4 L52,12 L52,34 Q52,52 30,58 Q8,52 8,34 L8,12 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <circle cx="30" cy="31" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="30" cy="31" r="2.2" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="1" opacity="0.75">
          <line x1="30" y1="25" x2="30" y2="16" />
          <line x1="35.2" y1="28" x2="41" y2="22" />
          <line x1="35.2" y1="34" x2="41" y2="41" />
          <line x1="30" y1="37" x2="30" y2="46" />
          <line x1="24.8" y1="34" x2="19" y2="41" />
          <line x1="24.8" y1="28" x2="19" y2="22" />
          <circle cx="30" cy="15" r="2" fill="currentColor" />
          <circle cx="42" cy="21" r="2" fill="currentColor" />
          <circle cx="42" cy="42" r="2" fill="currentColor" />
          <circle cx="30" cy="47" r="2" fill="currentColor" />
          <circle cx="18" cy="42" r="2" fill="currentColor" />
          <circle cx="18" cy="21" r="2" fill="currentColor" />
        </g>
      </svg>
    </span>
  );
}
