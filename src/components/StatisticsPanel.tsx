import { useId, useState } from 'react';
import type { RankingEntry, StatTab } from '../types';
import { rankingDisclosure } from '../lib/rankings';
import { Chip, Stat } from './uiPrimitives';

export interface SummaryMetrics {
  flightCount: number;
  internationalCount: number;
  domesticCount: number;
  distanceKm: number;
  countryCount: number;
  airportCount: number;
}

interface SummaryStatisticsProps {
  metrics: SummaryMetrics;
  showTypeBreakdown: boolean;
  live: boolean;
}

export function SummaryStatistics({
  metrics,
  showTypeBreakdown,
  live,
}: SummaryStatisticsProps) {
  return (
    <>
      <div className="flc-stat-grid">
        <Stat
          label="비행 편수"
          value={metrics.flightCount}
          sub={
            showTypeBreakdown
              ? `국제 ${metrics.internationalCount} · 국내 ${metrics.domesticCount}`
              : undefined
          }
        />
        <Stat
          label="비행 거리"
          value={`${metrics.distanceKm.toLocaleString()} km`}
          sub={`지구 ${(metrics.distanceKm / 40075).toFixed(1)}바퀴`}
        />
        <Stat label="방문 국가" value={metrics.countryCount} />
        <Stat label="이용 공항" value={metrics.airportCount} />
      </div>
      {live && (
        <div className="flc-live-label">
          <span className="flc-livedot" aria-hidden="true" />
          재생 진행에 맞춰 집계 중
        </div>
      )}
    </>
  );
}

interface RankingsPanelProps {
  tab: StatTab;
  onTabChange: (tab: StatTab) => void;
  rankings: readonly RankingEntry[];
  activeNames: ReadonlySet<string> | null;
  live: boolean;
}

export function RankingsPanel({
  tab,
  onTabChange,
  rankings,
  activeNames,
  live,
}: RankingsPanelProps) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const disclosure = rankingDisclosure(rankings, expanded);

  return (
    <div className="flc-rankings">
      <div className="flc-rankings-header">
        <div className="flc-rankings-tabs" aria-label="순위 기준">
          {(['국가', '도시', '공항', '항공사'] as const).map((item) => (
            <Chip key={item} on={tab === item} onClick={() => onTabChange(item)}>
              {item}
            </Chip>
          ))}
        </div>
        {live && (
          <div className="flc-live-label">
            <span className="flc-livedot" aria-hidden="true" />
            실시간 순위
          </div>
        )}
      </div>
      {rankings.length === 0 ? (
        <div className="flc-empty-state" role="status">
          표시할 데이터가 없어요. 필터를 바꿔보세요.
        </div>
      ) : (
        <ol className="flc-ranking-list" id={contentId}>
          {disclosure.entries.map(([name, count], index) => {
            const max = rankings[0][1];
            const isGrowing = activeNames?.has(name);
            return (
              <li key={name} className="flc-ranking-row">
                <span className="flc-ranking-number">{index + 1}</span>
                <div>
                  <div className="flc-ranking-name">{name}</div>
                  <div className="flc-ranking-track" aria-hidden="true">
                    <div
                      className="flc-ranking-bar"
                      data-growing={isGrowing || undefined}
                      style={{ width: `${(count / max) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="flc-ranking-count">{count}</span>
              </li>
            );
          })}
        </ol>
      )}
      {disclosure.canToggle && (
        <div className="flc-ranking-disclosure">
          <span aria-live="polite">
            {disclosure.entries.length.toLocaleString()} /{' '}
            {disclosure.total.toLocaleString()}개 표시
          </span>
          <button
            className="flc-btn flc-ranking-toggle"
            type="button"
            aria-controls={contentId}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? '상위 10개만 보기' : '전체 순위 보기'}
          </button>
        </div>
      )}
      <p className="flc-ranking-note">
        {tab === '공항' || tab === '도시'
          ? '출발·도착 각각 1회로 집계'
          : tab === '국가'
            ? '한 비행에서 스친 국가마다 1회로 집계'
            : '운항사(operating carrier) 기준'}
      </p>
    </div>
  );
}
