import type { ManualFlightRecord } from '../lib/manualFlight';
import {
  canEnterManualArchive,
  manualEntryEditControlId,
  manualEntryFlights,
} from '../lib/manualEntryFlow';

interface ManualEntryViewProps {
  records: readonly ManualFlightRecord[];
  onAddFlight: () => void;
  onEditFlight: (manualId: string) => void;
  onDeleteFlight: (manualId: string) => void;
  onOpenArchive: () => void;
  onOpenDataManagement: () => void;
  onOpenDemo: () => void;
}

function flightMetadata(airline: string, flightNumber: string, aircraft: string): string {
  return [airline, flightNumber, aircraft].filter(Boolean).join(' · ');
}

export default function ManualEntryView({
  records,
  onAddFlight,
  onEditFlight,
  onDeleteFlight,
  onOpenArchive,
  onOpenDataManagement,
  onOpenDemo,
}: ManualEntryViewProps) {
  const flights = manualEntryFlights(records);
  const canOpenArchive = canEnterManualArchive(records.length);
  const addLabel = records.length === 0 ? '+ 첫 비행 기록 추가' : '+ 비행 추가';

  return (
    <main className="flc-app flc-entry">
      <div className="flc-entry-shell">
        <header className="flc-entry-header">
          <div className="flc-eyebrow">PERSONAL FLIGHT LOG</div>
          <h1 id="manual-entry-title" tabIndex={-1}>비행 기록을 추가해보세요.</h1>
          <p>
            한 편씩 저장한 뒤, 준비가 되면 전체 비행 기록으로 이동하세요.
            기록은 이 페이지가 열려 있는 동안만 유지되며 새로고침하면 초기화됩니다.
          </p>
          <div className="flc-entry-primary-action">
            <button
              id="manual-entry-add"
              className="flc-btn flc-btn-primary"
              type="button"
              onClick={onAddFlight}
            >
              {addLabel}
            </button>
          </div>
        </header>

        <section className="flc-entry-records" aria-labelledby="entry-records-heading">
          <div className="flc-entry-records-heading">
            <div>
              <div className="flc-eyebrow">RECORDED FLIGHTS</div>
              <h2 id="entry-records-heading">추가한 비행</h2>
            </div>
            <span aria-live="polite">{records.length.toLocaleString()}편</span>
          </div>

          {flights.length === 0 ? (
            <div className="flc-entry-empty" role="status">
              <strong>아직 추가한 비행이 없습니다.</strong>
              <p>첫 기록을 저장하면 이곳에서 바로 확인하고 계속 추가할 수 있습니다.</p>
            </div>
          ) : (
            <ol className="flc-entry-list" aria-live="polite">
              {flights.map((flight) => {
                const metadata = flightMetadata(flight.al, flight.fn, flight.ac);
                return (
                  <li className="flc-entry-flight" key={flight.manualId ?? flight.id}>
                    <article>
                      <time dateTime={flight.sortKey.replace(/\./g, '-')}>{flight.d}</time>
                      <strong>{flight.fa} <span aria-hidden="true">→</span> {flight.ta}</strong>
                      {metadata && <p>{metadata}</p>}
                    </article>
                    {flight.manualId && (
                      <div className="flc-entry-flight-actions" aria-label={`${flight.fa}에서 ${flight.ta} 비행 기록 작업`}>
                        <button
                          id={manualEntryEditControlId(flight.manualId)}
                          className="flc-btn"
                          type="button"
                          onClick={() => onEditFlight(flight.manualId!)}
                        >
                          수정
                        </button>
                        <button
                          className="flc-btn flc-btn-danger-quiet"
                          type="button"
                          aria-label={`${flight.d} ${flight.fa}에서 ${flight.ta} 비행 기록 삭제`}
                          onClick={() => onDeleteFlight(flight.manualId!)}
                        >
                          삭제
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flc-entry-actions">
            <button className="flc-btn" type="button" onClick={onAddFlight}>
              {addLabel}
            </button>
            {canOpenArchive ? (
              <button className="flc-btn flc-btn-primary" type="button" onClick={onOpenArchive}>
                내 비행 기록 보기
              </button>
            ) : (
              <p className="flc-entry-archive-note">한 편 이상 저장하면 전체 비행 기록을 볼 수 있습니다.</p>
            )}
          </div>
        </section>

        <footer className="flc-entry-footer">
          <button className="flc-btn" type="button" onClick={onOpenDataManagement}>데이터 관리</button>
          {records.length === 0 && (
            <button className="flc-btn" type="button" onClick={onOpenDemo}>합성 샘플로 둘러보기</button>
          )}
          <p>
            기록을 남겨두려면 새로고침 전에 JSON 백업 또는 CSV 내보내기를 사용하세요.
          </p>
        </footer>
      </div>
    </main>
  );
}
