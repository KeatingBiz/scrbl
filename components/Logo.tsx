export function Logo() {
  return (
    <svg
      viewBox="0 0 600 220"
      className="w-[320px] h-auto"
      aria-label="SCRBL"
    >
      <g transform="rotate(-12 300 110)">
        <text
          x="310" y="70"
          fontFamily="Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
          fontSize="64" fontWeight="800"
          letterSpacing="-0.02em" textAnchor="middle"
          fill="#39FF14"
        >SCRBL</text>
        <path
          d="M90,150 C120,130 140,115 165,125 S205,165 230,150 S270,115 295,130 L340,170 L410,105"
          fill="none" stroke="#39FF14" strokeWidth="18"
          strokeLinecap="round" strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
