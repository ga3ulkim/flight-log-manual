import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { aggregateFlights, routeKey } from '../lib/analytics';
import { MAP_HEIGHT, MAP_WIDTH, arcGeometry } from '../lib/geography';
import { makeFlight } from '../testFixtures';
import type { Flight, PlaybackState, RouteKey } from '../types';
import FlightMap from './FlightMap';

const MAP_LAYERS = ['grid', 'land', 'routes', 'airports', 'vehicles'] as const;
const WORLD_OFFSETS = [-MAP_WIDTH, 0, MAP_WIDTH] as const;
const IDLE_PLAYBACK: PlaybackState = {
  on: false,
  idx: -1,
  t: 0,
  hold: 0,
  holdTotal: 0,
  speed: 1,
};

const count = (value: string, token: string): number => value.split(token).length - 1;

function layerMarkup(
  markup: string,
  layer: (typeof MAP_LAYERS)[number],
): string {
  const layerIndex = MAP_LAYERS.indexOf(layer);
  const start = markup.indexOf(`data-map-layer="${layer}"`);
  const nextLayer = MAP_LAYERS[layerIndex + 1];
  const end = nextLayer
    ? markup.indexOf(`data-map-layer="${nextLayer}"`, start)
    : markup.indexOf('</svg>', start);
  if (start < 0 || end < 0) throw new Error(`Missing SVG layer: ${layer}`);
  return markup.slice(start, end);
}

interface RenderMapOptions {
  flights: readonly Flight[];
  play?: PlaybackState;
  playActive?: boolean;
  currentFlight?: Flight | null;
  currentRouteKey?: RouteKey | null;
}

function renderMap({
  flights,
  play = IDLE_PLAYBACK,
  playActive = false,
  currentFlight = null,
  currentRouteKey = null,
}: RenderMapOptions): string {
  const analytics = aggregateFlights(flights);
  return renderToStaticMarkup(
    <FlightMap
      svgRef={createRef<SVGSVGElement>()}
      camera={{ s: 1, cx: MAP_WIDTH / 2, cy: MAP_HEIGHT / 2 }}
      analytics={analytics}
      topLabels={[...analytics.apUse.keys()]}
      selectedKey={null}
      selectedRoute={null}
      selectedDistanceKm={null}
      play={play}
      playActive={playActive}
      playedKeys={null}
      currentFlight={currentFlight}
      currentRouteKey={currentRouteKey}
      sequence={flights}
      onPointerDown={() => undefined}
      onBackgroundClick={() => undefined}
      onRouteClick={() => undefined}
      onCloseRoute={() => undefined}
      onTogglePlayback={() => undefined}
      onStopPlayback={() => undefined}
      onCycleSpeed={() => undefined}
      onZoomIn={() => undefined}
      onZoomOut={() => undefined}
      onResetCamera={() => undefined}
    />,
  );
}

describe('FlightMap SVG layer structure', () => {
  it('renders global semantic layers in a stable paint order across all world copies', () => {
    const markup = renderMap({ flights: [makeFlight()] });
    const layerIndexes = MAP_LAYERS.map((layer) =>
      markup.indexOf(`data-map-layer="${layer}"`),
    );

    expect(markup).toContain(`viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}"`);
    expect(layerIndexes.every((index) => index >= 0)).toBe(true);
    expect(layerIndexes).toEqual([...layerIndexes].sort((a, b) => a - b));
    expect(count(markup, 'data-map-layer=')).toBe(MAP_LAYERS.length);

    for (const layer of MAP_LAYERS) {
      const layerContent = layerMarkup(markup, layer);
      expect(count(layerContent, 'data-world-offset=')).toBe(WORLD_OFFSETS.length);
      for (const offset of WORLD_OFFSETS) {
        expect(count(layerContent, `data-world-offset="${offset}"`)).toBe(1);
        expect(count(layerContent, `transform="translate(${offset},0)"`)).toBe(1);
      }
    }

    expect(layerIndexes[1]).toBeLessThan(layerIndexes[2]);
    expect(layerIndexes[2]).toBeLessThan(layerIndexes[3]);
    expect(layerIndexes[3]).toBeLessThan(layerIndexes[4]);
  });

  it.each([
    ['ICN', 'LAX', 'right'],
    ['LAX', 'ICN', 'left'],
    ['NRT', 'SFO', 'right'],
    ['SFO', 'NRT', 'left'],
    ['NRT', 'HNL', 'right'],
    ['HNL', 'NRT', 'left'],
    ['HND', 'HNL', 'right'],
    ['HNL', 'HND', 'left'],
    ['AKL', 'LAX', 'right'],
    ['LAX', 'AKL', 'left'],
    ['SYD', 'LAX', 'right'],
    ['LAX', 'SYD', 'left'],
    ['ICN', 'NRT', 'none'],
  ] as const)(
    'keeps the %s to %s route geometry and hit targets wholly inside the global route layer',
    (from, to, wrapDirection) => {
      const flight = makeFlight({ fa: from, ta: to });
      const geometry = arcGeometry(from, to);
      const markup = renderMap({ flights: [flight] });
      const landLayer = layerMarkup(markup, 'land');
      const routeLayer = layerMarkup(markup, 'routes');
      const key = routeKey(from, to);

      if (wrapDirection === 'right') expect(geometry.x2).toBeGreaterThan(MAP_WIDTH);
      if (wrapDirection === 'left') expect(geometry.x2).toBeLessThan(0);
      if (wrapDirection === 'none') {
        expect(geometry.x1).toBeGreaterThanOrEqual(0);
        expect(geometry.x1).toBeLessThanOrEqual(MAP_WIDTH);
        expect(geometry.x2).toBeGreaterThanOrEqual(0);
        expect(geometry.x2).toBeLessThanOrEqual(MAP_WIDTH);
      }

      expect(landLayer).not.toContain(`data-route-key="${key}"`);
      expect(count(routeLayer, `data-route-key="${key}"`)).toBe(3);
      expect(count(routeLayer, `d="${geometry.d}"`)).toBe(6);
      expect(count(routeLayer, 'class="flc-route-hit"')).toBe(3);
      expect(count(routeLayer, 'class="flc-route-line"')).toBe(3);
      expect(count(routeLayer, 'role="button"')).toBe(1);
      expect(count(routeLayer, 'tabindex="0"')).toBe(1);
      expect(count(routeLayer, 'tabindex="-1"')).toBe(2);
    },
  );

  it('keeps every repeated aircraft copy in the topmost vehicle layer', () => {
    const flight = makeFlight({ fa: 'ICN', ta: 'LAX' });
    const markup = renderMap({
      flights: [flight],
      play: { ...IDLE_PLAYBACK, on: true, idx: 0, t: 0.5 },
      playActive: true,
      currentFlight: flight,
      currentRouteKey: routeKey(flight.fa, flight.ta),
    });
    const airportLayer = layerMarkup(markup, 'airports');
    const routeLayer = layerMarkup(markup, 'routes');
    const vehicleLayer = layerMarkup(markup, 'vehicles');

    expect(airportLayer).not.toContain('data-vehicle=');
    expect(routeLayer).not.toContain('tabindex="0"');
    expect(count(vehicleLayer, 'data-vehicle="aircraft"')).toBe(3);
    expect(vehicleLayer).not.toContain('data-vehicle="ground-transfer"');
  });

  it('keeps every repeated transfer copy in the topmost vehicle layer', () => {
    const currentFlight = makeFlight({ fa: 'ICN', ta: 'NRT' });
    const nextFlight = makeFlight({
      id: 1,
      fa: 'HND',
      ta: 'KIX',
      d: '2099.01.02',
      sortKey: '2099.01.02',
    });
    const markup = renderMap({
      flights: [currentFlight, nextFlight],
      play: {
        ...IDLE_PLAYBACK,
        on: true,
        idx: 0,
        t: 1,
        hold: 1_000,
        holdTotal: 2_000,
      },
      playActive: true,
      currentFlight,
      currentRouteKey: routeKey(currentFlight.fa, currentFlight.ta),
    });
    const routeLayer = layerMarkup(markup, 'routes');
    const vehicleLayer = layerMarkup(markup, 'vehicles');

    expect(routeLayer).not.toContain('data-vehicle=');
    expect(count(vehicleLayer, 'data-vehicle="ground-transfer"')).toBe(3);
    expect(count(vehicleLayer, 'data-vehicle-kind="bus"')).toBe(3);
    expect(vehicleLayer).not.toContain('data-vehicle="aircraft"');
  });
});
