import type { Flight, PlaybackState } from '../types';
import {
  AIRPORTS,
  arcGeometry,
  clamp,
  quadraticAngle,
  quadraticPoint,
  wrapTowards,
} from '../lib/geography';
import type { TransferMode } from '../lib/landSeaTransfer';
import { COLORS } from './theme';

export type PlaneCategory =
  | 'wide'
  | 'narrow_classic'
  | 'narrow_neo'
  | 'regional_tail'
  | 'regional_wing';

interface PlaneEngine {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

interface PlaneShape {
  body: string;
  wing: string;
  tail: string;
  eng: PlaneEngine[];
}

function aircraftCategory(aircraft: string): PlaneCategory {
  const normalized = String(aircraft || '').toUpperCase();
  if (/CRJ/.test(normalized)) return 'regional_tail';
  if (/\bE1[79]\d\b|ERJ|EMBRAER/.test(normalized)) return 'regional_wing';
  if (/787|777|747|767|A330|A340|A350|A380/.test(normalized)) return 'wide';
  if (/MAX|NEO/.test(normalized)) return 'narrow_neo';
  return 'narrow_classic';
}

const AIRCRAFT_SCALE: Record<PlaneCategory, number> = {
  wide: 1.15,
  narrow_classic: 1,
  narrow_neo: 1,
  regional_tail: 0.9,
  regional_wing: 0.92,
};

const PLANE_SHAPES: Record<PlaneCategory, PlaneShape> = {
  wide: {
    body: 'M15,0 L12.5,-1.7 L-4,-2.6 L-11,-1.8 L-15,-0.5 L-15,0.5 L-11,1.8 L-4,2.6 L12.5,1.7 Z',
    wing: 'M3.5,-1.9 L-1.5,-10.4 L-5,-10.4 L-3.6,-2.1 Z M3.5,1.9 L-1.5,10.4 L-5,10.4 L-3.6,2.1 Z',
    tail: 'M-11.5,-1.6 L-14.6,-6.3 L-16,-6.3 L-13.2,-1.1 Z M-11.5,1.6 L-14.6,6.3 L-16,6.3 L-13.2,1.1 Z',
    eng: [
      { cx: -1.4, cy: -5.4, rx: 2.3, ry: 1.25 },
      { cx: -1.4, cy: 5.4, rx: 2.3, ry: 1.25 },
    ],
  },
  narrow_classic: {
    body: 'M13,0 L10.5,-1.3 L-3,-1.9 L-9,-1.2 L-13,-0.4 L-13,0.4 L-9,1.2 L-3,1.9 L10.5,1.3 Z',
    wing: 'M2.2,-1.4 L-1.6,-8.3 L-4.2,-8.3 L-3,-1.6 Z M2.2,1.4 L-1.6,8.3 L-4.2,8.3 L-3,1.6 Z',
    tail: 'M-9.6,-1.1 L-12.6,-4.7 L-13.9,-4.7 L-11.2,-0.8 Z M-9.6,1.1 L-12.6,4.7 L-13.9,4.7 L-11.2,0.8 Z',
    eng: [
      { cx: -2.3, cy: -4.3, rx: 1.5, ry: 0.85 },
      { cx: -2.3, cy: 4.3, rx: 1.5, ry: 0.85 },
    ],
  },
  narrow_neo: {
    body: 'M13,0 L10.5,-1.3 L-3,-1.9 L-9,-1.2 L-13,-0.4 L-13,0.4 L-9,1.2 L-3,1.9 L10.5,1.3 Z',
    wing: 'M2.2,-1.4 L-1.6,-8.3 L-4.2,-8.3 L-3,-1.6 Z M2.2,1.4 L-1.6,8.3 L-4.2,8.3 L-3,1.6 Z',
    tail: 'M-9.6,-1.1 L-12.6,-4.7 L-13.9,-4.7 L-11.2,-0.8 Z M-9.6,1.1 L-12.6,4.7 L-13.9,4.7 L-11.2,0.8 Z',
    eng: [
      { cx: -0.6, cy: -4.5, rx: 2.15, ry: 1.2 },
      { cx: -0.6, cy: 4.5, rx: 2.15, ry: 1.2 },
    ],
  },
  regional_tail: {
    body: 'M11,0 L9,-1.1 L-2,-1.6 L-7,-1.0 L-11,-0.3 L-11,0.3 L-7,1.0 L-2,1.6 L9,1.1 Z',
    wing: 'M1.6,-1.2 L-1,-6.4 L-3,-6.4 L-2,-1.4 Z M1.6,1.2 L-1,6.4 L-3,6.4 L-2,1.4 Z',
    tail: 'M-9.3,-0.9 L-11.6,-4.3 L-12.9,-4.3 L-10.6,-0.6 Z M-9.3,0.9 L-11.6,4.3 L-12.9,4.3 L-10.6,0.6 Z',
    eng: [
      { cx: -7.6, cy: -1.7, rx: 1.5, ry: 0.8 },
      { cx: -7.6, cy: 1.7, rx: 1.5, ry: 0.8 },
    ],
  },
  regional_wing: {
    body: 'M11,0 L9,-1.1 L-2,-1.6 L-7,-1.0 L-11,-0.3 L-11,0.3 L-7,1.0 L-2,1.6 L9,1.1 Z',
    wing: 'M1.8,-1.2 L-0.8,-6.6 L-2.9,-6.6 L-1.8,-1.4 Z M1.8,1.2 L-0.8,6.6 L-2.9,6.6 L-1.8,1.4 Z',
    tail: 'M-8.6,-0.9 L-10.9,-3.9 L-11.9,-3.9 L-9.9,-0.6 Z M-8.6,0.9 L-10.9,3.9 L-11.9,3.9 L-9.9,0.6 Z',
    eng: [
      { cx: -1.7, cy: -3.4, rx: 1.15, ry: 0.65 },
      { cx: -1.7, cy: 3.4, rx: 1.15, ry: 0.65 },
    ],
  },
};

function PlaneIcon({ category }: { category: PlaneCategory }) {
  const shape = PLANE_SHAPES[category];
  return (
    <>
      <path
        d={shape.wing}
        fill={COLORS.ink}
        stroke={COLORS.card}
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      {shape.eng.map((engine, index) => (
        <ellipse
          key={index}
          cx={engine.cx}
          cy={engine.cy}
          rx={engine.rx}
          ry={engine.ry}
          fill={COLORS.ink}
          stroke={COLORS.card}
          strokeWidth="0.7"
        />
      ))}
      <path
        d={shape.tail}
        fill={COLORS.ink}
        stroke={COLORS.card}
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      <path
        d={shape.body}
        fill={COLORS.ink}
        stroke={COLORS.card}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </>
  );
}

function BusIcon() {
  return (
    <>
      <path
        d="M-8,-3.6 Q-8,-4.2 -7.2,-4.2 L5.6,-4.2 Q7.4,-4.2 7.9,-2.6 L8.3,-0.6 L8.3,1.6 Q8.3,2.3 7.5,2.3 L-7.6,2.3 Q-8.3,2.3 -8.3,1.5 Z"
        fill={COLORS.ink}
        stroke={COLORS.card}
        strokeWidth="0.5"
      />
      <rect x="-6.6" y="-3.1" width="4.6" height="2.6" rx="0.5" fill={COLORS.card} />
      <rect x="-1.3" y="-3.1" width="4.6" height="2.6" rx="0.5" fill={COLORS.card} />
      <rect x="4" y="-2.8" width="3" height="2.3" rx="0.5" fill={COLORS.card} />
      <circle cx="-4.4" cy="2.3" r="1.7" fill={COLORS.ink} stroke={COLORS.card} strokeWidth="0.5" />
      <circle cx="-4.4" cy="2.3" r="0.6" fill={COLORS.card} />
      <circle cx="4.6" cy="2.3" r="1.7" fill={COLORS.ink} stroke={COLORS.card} strokeWidth="0.5" />
      <circle cx="4.6" cy="2.3" r="0.6" fill={COLORS.card} />
    </>
  );
}

function FerryIcon() {
  return (
    <>
      <path
        d="M-10,1.1 L9.4,1.1 L6.7,4.4 L-6.8,4.4 Q-8.7,3.4 -10,1.1 Z"
        fill={COLORS.ink}
        stroke={COLORS.card}
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      <path
        d="M-6.8,1.1 L-5.3,-3.1 L3.6,-3.1 L7.1,1.1 Z"
        fill={COLORS.ink}
        stroke={COLORS.card}
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      <path
        d="M-3.8,-3.1 L-2.8,-5.2 L0.3,-5.2 L1.2,-3.1 Z"
        fill={COLORS.ink}
        stroke={COLORS.card}
        strokeWidth="0.6"
      />
      <rect x="-4.5" y="-2.1" width="2.5" height="1.5" rx="0.35" fill={COLORS.card} />
      <rect x="-1.2" y="-2.1" width="2.5" height="1.5" rx="0.35" fill={COLORS.card} />
      <rect x="2.1" y="-2.1" width="2.3" height="1.5" rx="0.35" fill={COLORS.card} />
    </>
  );
}

interface AircraftMarkerProps {
  currentFlight: Flight | null;
  nextFlight: Flight | undefined;
  play: PlaybackState;
  inverseCameraScale: number;
  transferMode: TransferMode | null;
}

export default function AircraftMarker({
  currentFlight,
  nextFlight,
  play,
  inverseCameraScale,
  transferMode,
}: AircraftMarkerProps) {
  if (!currentFlight) return null;

  const geometry = arcGeometry(currentFlight.fa, currentFlight.ta);
  if (play.hold > 0) {
    const [fromX, fromY] = quadraticPoint(geometry, 1);
    const nextAirport = nextFlight ? AIRPORTS[nextFlight.fa] : undefined;
    const [toX, toY] = nextAirport
      ? wrapTowards(fromX, nextAirport[0], nextAirport[1])
      : [fromX, fromY];
    const transferProgress = clamp(1 - play.hold / (play.holdTotal || 1100), 0, 1);
    const x = fromX + (toX - fromX) * transferProgress;
    const y = fromY + (toY - fromY) * transferProgress;
    const scale = 1.65 * inverseCameraScale;
    const direction = toX - fromX < 0 ? -1 : 1;
    const mode = transferMode ?? 'land';
    return (
      <g
        data-vehicle="ground-transfer"
        data-transfer-mode={mode}
        data-vehicle-kind={mode === 'sea' ? 'ferry' : 'bus'}
        transform={`translate(${x},${y}) scale(${scale * direction},${scale})`}
        pointerEvents="none"
        aria-hidden="true"
      >
        {mode === 'sea' ? <FerryIcon /> : <BusIcon />}
      </g>
    );
  }

  const progress = clamp(play.t, 0, 1);
  const [x, y] = quadraticPoint(geometry, progress);
  const angle = quadraticAngle(geometry, progress);
  const category = aircraftCategory(currentFlight.ac);
  const scale = 1.7 * AIRCRAFT_SCALE[category] * inverseCameraScale;
  return (
    <g
      data-vehicle="aircraft"
      transform={`translate(${x},${y}) rotate(${angle}) scale(${scale})`}
      pointerEvents="none"
    >
      <PlaneIcon category={category} />
    </g>
  );
}
