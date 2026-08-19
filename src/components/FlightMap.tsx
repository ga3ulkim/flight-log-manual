import { useMemo, type PointerEventHandler, type RefObject } from 'react';
import { LAND, type LandPoint } from '../data/landGeometry';
import { routeKey } from '../lib/analytics';
import {
  AIRPORTS,
  MAP_HEIGHT,
  MAP_WIDTH,
  arcGeometry,
  clamp,
  projectLatitude,
  projectLongitude,
} from '../lib/geography';
import {
  geographicPoint,
  segmentTransferByLand,
  transferModeAt,
  type TransferMode,
} from '../lib/landSeaTransfer';
import type {
  Camera,
  Flight,
  FlightAnalytics,
  PlaybackState,
  RouteKey,
  RouteRecord,
} from '../types';
import AircraftMarker from './AircraftMarker';
import PlaybackUI from './PlaybackUI';
import RouteDetail from './RouteDetail';
import { COLORS, MONO_FONT } from './theme';

const ringPath = (points: readonly LandPoint[]): string =>
  points
    .map(
      (point, index) =>
        `${index ? 'L' : 'M'}${projectLongitude(point[0]).toFixed(1)},${projectLatitude(point[1]).toFixed(1)}`,
    )
    .join('') + 'Z';

const LAND_PATHS = LAND.map((rings) => rings.map(ringPath).join(''));

interface FlightMapProps {
  svgRef: RefObject<SVGSVGElement>;
  camera: Camera;
  analytics: FlightAnalytics;
  topLabels: readonly string[];
  selectedKey: RouteKey | null;
  selectedRoute: RouteRecord | null;
  selectedDistanceKm: number | null;
  play: PlaybackState;
  playActive: boolean;
  playedKeys: ReadonlySet<RouteKey> | null;
  currentFlight: Flight | null;
  currentRouteKey: RouteKey | null;
  sequence: readonly Flight[];
  onPointerDown: PointerEventHandler<SVGSVGElement>;
  onBackgroundClick: () => void;
  onRouteClick: (key: RouteKey) => void;
  onCloseRoute: () => void;
  onTogglePlayback: () => void;
  onStopPlayback: () => void;
  onCycleSpeed: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetCamera: () => void;
}

export default function FlightMap({
  svgRef,
  camera,
  analytics,
  topLabels,
  selectedKey,
  selectedRoute,
  selectedDistanceKm,
  play,
  playActive,
  playedKeys,
  currentFlight,
  currentRouteKey,
  sequence,
  onPointerDown,
  onBackgroundClick,
  onRouteClick,
  onCloseRoute,
  onTogglePlayback,
  onStopPlayback,
  onCycleSpeed,
  onZoomIn,
  onZoomOut,
  onResetCamera,
}: FlightMapProps) {
  const viewWidth = MAP_WIDTH / camera.s;
  const viewHeight = MAP_HEIGHT / camera.s;
  const viewX = camera.cx - viewWidth / 2;
  const viewY = clamp(camera.cy - viewHeight / 2, 0, MAP_HEIGHT - viewHeight);
  const inverseScale = 1 / camera.s;
  const showAllLabels = camera.s >= 3;
  const nextFlight = sequence[play.idx + 1];
  const transferSegments = useMemo(() => {
    if (!currentFlight || !nextFlight || currentFlight.ta === nextFlight.fa) return null;
    const from = AIRPORTS[currentFlight.ta];
    const to = AIRPORTS[nextFlight.fa];
    if (!from || !to) return null;
    return segmentTransferByLand(geographicPoint(from), geographicPoint(to));
  }, [currentFlight, nextFlight]);
  const transferProgress =
    play.hold > 0 && play.holdTotal > 0
      ? clamp(1 - play.hold / play.holdTotal, 0, 1)
      : 0;
  const transferMode: TransferMode | null =
    play.hold > 0
      ? transferSegments
        ? transferModeAt(transferSegments, transferProgress)
        : 'land'
      : null;

  return (
    <div className="flc-map-card">
      <div className="flc-map-header">
        <div>
          {analytics.routes.size > 0
            ? '노선을 선택하면 기록을 볼 수 있어요 · 재생 중 카메라 자동 추적'
            : '지도 좌표가 있는 노선이 없습니다 · 기록과 통계는 아래에서 계속 볼 수 있어요'}
        </div>
        <div className="flc-map-legend" aria-label="노선 범례">
          {playActive ? (
            <span>
              <span
                className="flc-map-legend-line"
                style={{ background: COLORS.flown }}
                aria-hidden="true"
              />
              지나간 구간
            </span>
          ) : (
            <>
              <span>
                <span
                  className="flc-map-legend-line"
                  style={{ background: COLORS.intl }}
                  aria-hidden="true"
                />
                국제선
              </span>
              <span>
                <span
                  className="flc-map-legend-line"
                  style={{ background: COLORS.dom }}
                  aria-hidden="true"
                />
                국내선
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flc-map-stage">
        <svg
          ref={svgRef}
          className="flc-map-svg"
          viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
          onPointerDown={onPointerDown}
          role="group"
          aria-label="비행 노선 지도"
        >
          <rect
            x={-MAP_WIDTH}
            y={0}
            width={3 * MAP_WIDTH}
            height={MAP_HEIGHT}
            fill="transparent"
            onClick={onBackgroundClick}
          />
          {[-MAP_WIDTH, 0, MAP_WIDTH].map((worldOffset) => (
            <g
              key={`world${worldOffset}`}
              transform={`translate(${worldOffset},0)`}
              aria-hidden={worldOffset === 0 ? undefined : true}
            >
              {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map(
                (longitude) => (
                  <line
                    key={`v${longitude}`}
                    x1={projectLongitude(longitude)}
                    y1={0}
                    x2={projectLongitude(longitude)}
                    y2={MAP_HEIGHT}
                    stroke={COLORS.ink}
                    strokeWidth="0.3"
                    opacity="0.10"
                    vectorEffect="non-scaling-stroke"
                  />
                ),
              )}
              {[60, 30, 0, -30].map((latitude) => (
                <line
                  key={`h${latitude}`}
                  x1={0}
                  y1={projectLatitude(latitude)}
                  x2={MAP_WIDTH}
                  y2={projectLatitude(latitude)}
                  stroke={COLORS.ink}
                  strokeWidth="0.3"
                  opacity={latitude === 0 ? 0.22 : 0.1}
                  strokeDasharray={latitude === 0 ? '4 3' : ''}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {LAND_PATHS.map((path, index) => (
                <path
                  key={index}
                  d={path}
                  fill={COLORS.land}
                  fillRule="evenodd"
                  stroke={COLORS.landLine}
                  strokeWidth="0.6"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {[...analytics.routes.values()].map((route) => {
                if (!AIRPORTS[route.a] || !AIRPORTS[route.b]) return null;
                const key = routeKey(route.a, route.b);
                const geometry = arcGeometry(route.a, route.b);
                const selected = !playActive && selectedKey === key;
                const current = playActive && currentRouteKey === key;
                const flown = playActive && !current && playedKeys?.has(key);
                let strokeColor: string;
                let opacity: number;
                if (playActive) {
                  strokeColor = current
                    ? COLORS.hl
                    : flown
                      ? COLORS.flown
                      : route.intl
                        ? COLORS.intl
                        : COLORS.dom;
                  opacity = current ? 1 : flown ? 0.7 : 0;
                } else {
                  strokeColor = selected
                    ? COLORS.hl
                    : route.intl
                      ? COLORS.intl
                      : COLORS.dom;
                  opacity = selectedKey && !selected ? 0.16 : 0.82;
                }
                const baseWidth = Math.min(3.2, 1 + Math.log2(route.n + 1) * 0.7);
                return (
                  <g key={key}>
                    <path
                      className="flc-route-hit"
                      d={geometry.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="16"
                      vectorEffect="non-scaling-stroke"
                      style={{ cursor: playActive ? 'default' : 'pointer' }}
                      role={worldOffset === 0 ? 'button' : undefined}
                      tabIndex={worldOffset === 0 && !playActive ? 0 : -1}
                      aria-label={
                        worldOffset === 0
                          ? `${route.a}와 ${route.b} 사이 노선, ${route.n}편`
                          : undefined
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onRouteClick(key);
                      }}
                      onKeyDown={(event) => {
                        if (
                          worldOffset === 0 &&
                          !playActive &&
                          (event.key === 'Enter' || event.key === ' ')
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                          onRouteClick(key);
                        }
                      }}
                    />
                    <path
                      d={geometry.d}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={selected || current ? baseWidth + 1.4 : baseWidth}
                      opacity={opacity}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  </g>
                );
              })}
              {[...analytics.apUse.entries()].map(([code, usage]) => {
                const coordinate = AIRPORTS[code];
                if (!coordinate) return null;
                const [latitude, longitude] = coordinate;
                const radius = Math.min(6.5, 2 + Math.sqrt(usage.n) * 0.8) * inverseScale;
                const inSelectedRoute =
                  selectedRoute &&
                  (selectedRoute.a === code || selectedRoute.b === code);
                const inCurrentFlight =
                  currentFlight &&
                  (currentFlight.fa === code || currentFlight.ta === code);
                const showLabel = showAllLabels || topLabels.includes(code);
                return (
                  <g key={code} data-airport-code={code}>
                    <circle
                      cx={projectLongitude(longitude)}
                      cy={projectLatitude(latitude)}
                      r={radius}
                      fill={inSelectedRoute || inCurrentFlight ? COLORS.hl : COLORS.ink}
                      stroke={COLORS.card}
                      strokeWidth={inverseScale}
                    />
                    {showLabel && (
                      <text
                        x={projectLongitude(longitude) + radius + 3.5 * inverseScale}
                        y={projectLatitude(latitude) + 4 * inverseScale}
                        fontSize={13 * inverseScale}
                        fontFamily={MONO_FONT}
                        fill={COLORS.ink}
                        stroke={COLORS.card}
                        strokeWidth={3.4 * inverseScale}
                        paintOrder="stroke"
                        fontWeight="600"
                      >
                        {code}
                      </text>
                    )}
                  </g>
                );
              })}
              <AircraftMarker
                currentFlight={currentFlight}
                nextFlight={nextFlight}
                play={play}
                inverseCameraScale={inverseScale}
                transferMode={transferMode}
              />
            </g>
          ))}
        </svg>

        <PlaybackUI
          play={play}
          active={playActive}
          currentFlight={currentFlight}
          nextFlight={nextFlight}
          transferMode={transferMode}
          sequenceLength={sequence.length}
          onToggle={onTogglePlayback}
          onStop={onStopPlayback}
          onCycleSpeed={onCycleSpeed}
        />

        <div className="flc-map-controls" aria-label="지도 배율 컨트롤">
          <button className="flc-zoom" type="button" aria-label="확대" onClick={onZoomIn}>
            +
          </button>
          <button className="flc-zoom" type="button" aria-label="축소" onClick={onZoomOut}>
            −
          </button>
          <button
            className="flc-zoom"
            type="button"
            aria-label="전체 보기"
            onClick={onResetCamera}
          >
            ⟲
          </button>
        </div>
        <div className="flc-map-scale">
          ×{camera.s.toFixed(1)}
        </div>
      </div>

      {selectedRoute && (
        <RouteDetail
          route={selectedRoute}
          distanceKm={selectedDistanceKm}
          onClose={onCloseRoute}
        />
      )}
    </div>
  );
}
