import type { ReactNode } from 'react';

interface StatProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}

export function Stat({ label, value, sub }: StatProps) {
  return (
    <div className="flc-stat">
      <div className="flc-stat-label">{label}</div>
      <div className="flc-stat-value">{value}</div>
      {sub && <div className="flc-stat-sub">{sub}</div>}
    </div>
  );
}

interface ChipProps {
  on: boolean;
  children: ReactNode;
  onClick: () => void;
}

export function Chip({ on, children, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flc-chip"
      aria-pressed={on}
    >
      {children}
    </button>
  );
}
