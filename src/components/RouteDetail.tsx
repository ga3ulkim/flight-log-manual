import type { RouteRecord } from '../types';
import { compareFlightsChronologically } from '../lib/flightOrdering';

interface RouteDetailProps {
  route: RouteRecord;
  distanceKm: number | null;
  onClose: () => void;
}

function dateTimeValue(date: string, time?: string): string | undefined {
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(date)) return undefined;
  const canonicalDate = date.replace(/\./g, '-');
  return time ? `${canonicalDate}T${time}` : canonicalDate;
}

export default function RouteDetail({ route, distanceKm, onClose }: RouteDetailProps) {
  return (
    <aside
      className="flc-route-detail"
      aria-label={`${route.a}와 ${route.b} 사이의 노선 기록`}
    >
      <header className="flc-route-detail-header">
        <div>
          <h3>
            {route.a} <span>⇄</span> {route.b}
          </h3>
          <p className="flc-route-detail-summary">
            {route.n.toLocaleString()} FLIGHTS
            {distanceKm != null ? ` · ${distanceKm.toLocaleString()} KM` : ''}
          </p>
        </div>
        <button className="flc-btn" type="button" onClick={onClose}>
          닫기
        </button>
      </header>

      <ol className="flc-route-list">
        {route.items
          .slice()
          .sort(compareFlightsChronologically)
          .map((flight) => (
            <li
              key={flight.id}
              className="flc-route-row"
              data-flight-type={flight.type === '국제선' ? 'international' : 'domestic'}
            >
              <div className="flc-route-date">
                <time dateTime={dateTimeValue(flight.d)}>{flight.d || '—'}</time>
                {flight.departureTime && (
                  <time
                    className="flc-route-time"
                    dateTime={dateTimeValue(flight.d, flight.departureTime)}
                    aria-label={`출발 공항 현지 시각 ${flight.departureTime}`}
                  >
                    {flight.departureTime} <span aria-hidden="true">LOCAL</span>
                  </time>
                )}
              </div>
              <div className="flc-route-main">
                <b>
                  {flight.fa}→{flight.ta}
                </b>
                <span className="flc-route-airline">
                  {' '}· {flight.al || '항공사 미상'}
                </span>
              </div>
              <div className="flc-route-meta">
                {flight.fn || ''}
                {flight.ac && <div className="flc-route-aircraft">{flight.ac}</div>}
              </div>
            </li>
          ))}
      </ol>
    </aside>
  );
}
