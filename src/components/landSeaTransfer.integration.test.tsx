import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeFlight } from '../testFixtures';
import { knownAirport } from '../lib/geography';
import {
  geographicPoint,
  segmentTransferByLand,
  transferModeAt,
} from '../lib/landSeaTransfer';
import type { PlaybackState } from '../types';
import AircraftMarker from './AircraftMarker';
import PlaybackUI from './PlaybackUI';

const currentFlight = makeFlight({
  id: 0,
  fa: 'GDX',
  ta: 'ANC',
  al: 'Synthetic Previous Air',
  fn: 'SX 821',
  ac: 'Synthetic 800',
  d: '2099.06.01',
  sortKey: '2099.06.01',
});

const nextFlight = makeFlight({
  id: 1,
  fa: 'GDX',
  ta: 'PKC',
  d: '2099.06.02',
  sortKey: '2099.06.02',
});

describe('land/sea transfer presentation integration', () => {
  const renderPlayback = (
    play: PlaybackState,
    transferMode: 'land' | 'sea' | null,
    flight = currentFlight,
    followingFlight = nextFlight,
  ) =>
    renderToStaticMarkup(
      <PlaybackUI
        play={play}
        active
        currentFlight={flight}
        nextFlight={followingFlight}
        transferMode={transferMode}
        sequenceLength={2}
        onToggle={() => undefined}
        onStop={() => undefined}
        onCycleSpeed={() => undefined}
      />,
    );

  it('preserves route and metadata during an active flight', () => {
    const status = renderPlayback(
      { on: true, idx: 0, t: 0.5, hold: 0, holdTotal: 0, speed: 1 },
      null,
    );

    expect(status).toContain('GDX → ANC');
    expect(status).toContain('Synthetic Previous Air · SX 821 · Synthetic 800');
    expect(status).not.toContain('지상 이동');
    expect(status).not.toContain('해상 이동');
  });

  it.each([
    ['land', '지상 이동'],
    ['sea', '해상 이동'],
  ] as const)('shows only the current %s transfer activity', (mode, label) => {
    const status = renderPlayback(
      { on: true, idx: 0, t: 1, hold: 1_000, holdTotal: 2_000, speed: 1 },
      mode,
    );

    expect(status).toContain(`${label} → GDX`);
    expect(status).toContain(`data-transfer-mode="${mode}"`);
    expect(status).not.toContain('GDX → ANC');
    expect(status).not.toContain('Synthetic Previous Air');
    expect(status).not.toContain('SX 821');
    expect(status).not.toContain('Synthetic 800');
    expect(status).not.toContain('ANC → GDX');
    expect(status).not.toContain('연결 이동');
  });

  it('keeps the transfer activity correct across pause and resume', () => {
    const playing = renderPlayback(
      { on: true, idx: 0, t: 1, hold: 1_000, holdTotal: 2_000, speed: 1 },
      'sea',
    );
    const paused = renderPlayback(
      { on: false, idx: 0, t: 1, hold: 1_000, holdTotal: 2_000, speed: 1 },
      'sea',
    );

    expect(playing).toContain('해상 이동 → GDX');
    expect(playing).toContain('IN FLIGHT');
    expect(paused).toContain('해상 이동 → GDX');
    expect(paused).toContain('PAUSED');
    expect(paused).not.toContain('GDX → ANC');
  });

  it('renders a synchronized bus to ferry to bus sequence', () => {
    const segments = segmentTransferByLand(
      geographicPoint(knownAirport(currentFlight.ta)),
      geographicPoint(knownAirport(nextFlight.fa)),
    );
    expect(segments.map((segment) => segment.mode)).toEqual(['land', 'sea', 'land']);

    const renderedKinds: string[] = [];
    for (const segment of segments) {
      const progress = (segment.startT + segment.endT) / 2;
      const transferMode = transferModeAt(segments, progress);
      const holdTotal = 2_000;
      const play: PlaybackState = {
        on: true,
        idx: 0,
        t: 1,
        hold: (1 - progress) * holdTotal,
        holdTotal,
        speed: 1,
      };
      const marker = renderToStaticMarkup(
        <svg>
          <AircraftMarker
            currentFlight={currentFlight}
            nextFlight={nextFlight}
            play={play}
            inverseCameraScale={1}
            transferMode={transferMode}
          />
        </svg>,
      );
      const status = renderPlayback(play, transferMode);
      const expectedKind = transferMode === 'sea' ? 'ferry' : 'bus';
      const expectedLabel = transferMode === 'sea' ? '해상 이동' : '지상 이동';

      expect(marker).toContain(`data-transfer-mode="${transferMode}"`);
      expect(marker).toContain(`data-vehicle-kind="${expectedKind}"`);
      expect(status).toContain(`data-transfer-mode="${transferMode}"`);
      expect(status).toContain(`${expectedLabel} → GDX`);
      expect(status).not.toContain('GDX → ANC');
      expect(status).not.toContain('Synthetic Previous Air');
      expect(status).not.toContain('연결 이동');
      renderedKinds.push(expectedKind);
    }

    expect(renderedKinds).toEqual(['bus', 'ferry', 'bus']);
  });
});
