import { useId, useState } from 'react';
import type { Flight } from '../types';
import { timelineDateLabel, timelineDisclosure } from '../lib/timeline';

interface FlightTimelineProps {
  flights: readonly Flight[];
  onEditFlight?: (manualId: string) => void;
  onDeleteFlight?: (manualId: string) => void;
}

function joinedCities(flight: Flight): string {
  return [flight.fcity, flight.tcity].filter(Boolean).join(' → ');
}

export default function FlightTimeline({
  flights,
  onEditFlight,
  onDeleteFlight,
}: FlightTimelineProps) {
  const headingId = useId();
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const { groups, canToggle } = timelineDisclosure(flights, expanded);

  return (
    <section className="flc-timeline" aria-labelledby={headingId}>
      <header className="flc-section-heading flc-timeline-heading">
        <div>
          <div className="flc-eyebrow" aria-hidden="true">
            FLIGHT ARCHIVE
          </div>
          <h2 id={headingId}>비행 타임라인</h2>
        </div>
        <p>{flights.length.toLocaleString()}개의 기록 · 최신순</p>
      </header>

      {groups.length === 0 ? (
        <div className="flc-timeline-empty" id={contentId} role="status">
          현재 필터에 해당하는 비행 기록이 없습니다.
        </div>
      ) : (
        <>
          <div className="flc-timeline-groups" id={contentId}>
            {groups.map((group) => {
              const groupHeadingId = `${headingId}-${group.key}`;
              return (
                <section
                  className="flc-timeline-year"
                  aria-labelledby={groupHeadingId}
                  key={group.key}
                >
                  <header className="flc-timeline-year-heading">
                    <h3 id={groupHeadingId}>{group.label}</h3>
                    <span>
                      {group.flights.length}{' '}
                      {group.flights.length === 1 ? 'FLIGHT' : 'FLIGHTS'}
                    </span>
                  </header>

                  <ol className="flc-timeline-list">
                    {group.flights.map((flight) => {
                      const date = timelineDateLabel(flight);
                      const cities = joinedCities(flight);
                      return (
                        <li
                          className="flc-timeline-item"
                          data-flight-type={flight.type === '국제선' ? 'international' : 'domestic'}
                          key={flight.manualId ?? flight.id}
                        >
                          <article>
                            <div className="flc-timeline-date">
                              {date.dateTime ? (
                                <time dateTime={date.dateTime} aria-label={date.accessible}>
                                  {date.primary}
                                </time>
                              ) : (
                                <span aria-label={date.accessible}>{date.primary}</span>
                              )}
                              {flight.departureTime && (
                                <time
                                  className="flc-timeline-time"
                                  dateTime={date.dateTime?.length === 10
                                    ? `${date.dateTime}T${flight.departureTime}`
                                    : flight.departureTime}
                                  aria-label={`출발 공항 현지 시각 ${flight.departureTime}`}
                                >
                                  {flight.departureTime} <span aria-hidden="true">LOCAL</span>
                                </time>
                              )}
                            </div>

                            <div className="flc-timeline-flight">
                              <h4 aria-label={`${flight.fa}에서 ${flight.ta}까지`}>
                                <span aria-hidden="true">{flight.fa}</span>
                                <span aria-hidden="true">→</span>
                                <span aria-hidden="true">{flight.ta}</span>
                              </h4>
                              {cities && <p className="flc-timeline-cities">{cities}</p>}
                              {flight.al && <p className="flc-timeline-airline">{flight.al}</p>}
                            </div>

                            <div className="flc-timeline-meta">
                              <span className="flc-timeline-type">{flight.type}</span>
                              {flight.fn && <span>{flight.fn}</span>}
                              {flight.ac && <span>{flight.ac}</span>}
                            </div>

                            {flight.manualId && (onEditFlight || onDeleteFlight) && (
                              <div className="flc-timeline-actions" aria-label="비행 기록 작업">
                                {onEditFlight && (
                                  <button
                                    className="flc-btn"
                                    type="button"
                                    aria-label={`${flight.d} ${flight.fa}에서 ${flight.ta} 비행 수정`}
                                    onClick={() => onEditFlight(flight.manualId!)}
                                  >
                                    수정
                                  </button>
                                )}
                                {onDeleteFlight && (
                                  <button
                                    className="flc-btn flc-btn-danger-quiet"
                                    type="button"
                                    aria-label={`${flight.d} ${flight.fa}에서 ${flight.ta} 비행 삭제`}
                                    onClick={() => onDeleteFlight(flight.manualId!)}
                                  >
                                    삭제
                                  </button>
                                )}
                              </div>
                            )}
                          </article>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              );
            })}
          </div>
          {canToggle && (
            <div className="flc-timeline-toggle-row">
              <button
                className="flc-btn flc-timeline-toggle"
                type="button"
                aria-controls={contentId}
                aria-expanded={expanded}
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? '접기' : '펼치기'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
