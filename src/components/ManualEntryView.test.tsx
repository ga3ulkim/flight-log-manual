import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createManualFlight } from '../lib/manualFlight';
import type { ManualFlightInput, ManualFlightRecord } from '../lib/manualFlight';
import ManualEntryView from './ManualEntryView';

const noop = () => undefined;

function input(
  date: string,
  from: string,
  to: string,
  metadata: Partial<ManualFlightInput> = {},
): ManualFlightInput {
  return {
    date,
    departure: {
      iata: from,
      name: `${from} Airport`,
      municipality: `${from} City`,
      countryCode: 'KR',
      countryName: '대한민국',
      latitude: 37,
      longitude: 127,
    },
    arrival: {
      iata: to,
      name: `${to} Airport`,
      municipality: `${to} City`,
      countryCode: 'CN',
      countryName: '중국',
      latitude: 40,
      longitude: 116,
    },
    ...metadata,
  };
}

function record(
  id: string,
  flightInput: ManualFlightInput,
  timestamp: string,
): ManualFlightRecord {
  return createManualFlight(flightInput, {
    generateId: () => id,
    now: () => new Date(timestamp),
  });
}

function render(records: readonly ManualFlightRecord[]): string {
  return renderToStaticMarkup(
    <ManualEntryView
      records={records}
      onAddFlight={noop}
      onEditFlight={noop}
      onDeleteFlight={noop}
      onOpenArchive={noop}
      onOpenDataManagement={noop}
      onOpenDemo={noop}
    />,
  );
}

describe('manual entry view', () => {
  it('shows first-flight setup without an empty-archive transition button', () => {
    const markup = render([]);
    expect(markup).toContain('비행 기록을 추가해보세요.');
    expect(markup).toContain('+ 첫 비행 기록 추가');
    expect(markup).toContain('아직 추가한 비행이 없습니다.');
    expect(markup).not.toContain('내 비행 기록 보기');
  });

  it('shows authoritative saved records newest first with edit/delete controls', () => {
    const older = record(
      'older',
      input('2024-08-20', 'ICN', 'PEK', {
        airline: 'Air China',
        flightNumber: 'CA124',
        aircraft: 'A321',
      }),
      '2024-08-20T01:00:00.000Z',
    );
    const newer = record(
      'newer',
      input('2024-08-31', 'PEK', 'ICN'),
      '2024-08-31T01:00:00.000Z',
    );
    const markup = render([older, newer]);

    expect(markup).toContain('2편');
    expect(markup.indexOf('2024.08.31')).toBeLessThan(markup.indexOf('2024.08.20'));
    expect(markup).toContain('ICN');
    expect(markup).toContain('PEK');
    expect(markup).toContain('Air China · CA124 · A321');
    expect(markup).toContain('수정');
    expect(markup).toContain('삭제');
    expect(markup).toContain('내 비행 기록 보기');
    expect(markup).not.toContain('undefined');
  });
});
