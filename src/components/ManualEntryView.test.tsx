import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createManualFlight } from '../lib/manualFlight';
import type { ManualFlightInput, ManualFlightRecord } from '../lib/manualFlight';
import ManualEntryView from './ManualEntryView';

const noop = () => undefined;

type InteractiveElement = ReactElement<{
  children?: ReactNode;
  onClick?: () => void;
  'aria-label'?: string;
}>;

function findButtons(node: ReactNode): InteractiveElement[] {
  if (!isValidElement(node)) return [];
  const element = node as InteractiveElement;
  const descendants = Children.toArray(element.props.children)
    .flatMap((child) => findButtons(child));
  return element.type === 'button' ? [element, ...descendants] : descendants;
}

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
    expect(markup).toContain('새로고침하면 초기화됩니다.');
    expect(markup).not.toContain('IndexedDB');
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

  it('keeps the date-only time element valid when a departure time affects sorting', () => {
    const timed = record(
      'timed',
      input('2024-08-31', 'ICN', 'PEK', { departureTime: '14:30' }),
      '2024-08-31T01:00:00.000Z',
    );
    const markup = render([timed]);

    expect(markup).toContain('dateTime="2024-08-31"');
    expect(markup).not.toContain('dateTime="2024-08-31 14:30"');
  });

  it('invokes one immediate, context-labelled delete action without confirmation UI', () => {
    const saved = record(
      'delete-me',
      input('2024-08-20', 'ICN', 'PEK'),
      '2024-08-20T01:00:00.000Z',
    );
    const onDeleteFlight = vi.fn();
    const tree = ManualEntryView({
      records: [saved],
      onAddFlight: noop,
      onEditFlight: noop,
      onDeleteFlight,
      onOpenArchive: noop,
      onOpenDataManagement: noop,
      onOpenDemo: noop,
    });
    const deleteButton = findButtons(tree).find((button) => button.props.children === '삭제');

    expect(deleteButton?.props['aria-label']).toContain('ICN에서 PEK 비행 기록 삭제');
    expect(renderToStaticMarkup(tree)).not.toContain('이 비행 기록을 삭제할까요?');
    deleteButton?.props.onClick?.();
    expect(onDeleteFlight).toHaveBeenCalledTimes(1);
    expect(onDeleteFlight).toHaveBeenCalledWith(saved.id);
  });
});
