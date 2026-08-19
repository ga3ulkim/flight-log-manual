import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  activeRankingNames,
  aggregateFlights,
  aggregateLiveFlights,
  availableYears,
  filterFlights,
  rankingData,
  routeKey,
  topAirportLabels,
} from '../lib/analytics';
import {
  AIRPORTS,
  CAMERA_SCALE_MAX as S_MAX,
  CAMERA_SCALE_MIN as S_MIN,
  MAP_HEIGHT as H,
  MAP_WIDTH as W,
  arcGeometry as arcGeom,
  clamp,
  haversine,
  knownAirport,
  mapSpanCameraScale as spanScale,
  nearestWorldOffset,
  normalizeWorldX,
  quadraticPoint as quadPoint,
  routeCameraScale as routeScale,
  wrapTowards,
  type MapPoint,
} from '../lib/geography';
import {
  advancePlayback,
  chronologicalFlights,
  playedRouteKeys,
} from '../lib/playback';
import type {
  Camera,
  Flight,
  FlightFilter,
  PlaybackProgress,
  PlaybackState,
  StatTab,
  YearFilter,
} from '../types';
import FlightMap from './FlightMap';
import FlightTimeline from './FlightTimeline';
import { RankingsPanel, SummaryStatistics } from './StatisticsPanel';
import { Chip } from './uiPrimitives';
import './flightLog.css';


/* ============================================================
   FLIGHT LOG CHART v3
   · 노선 클릭 정보 복구 (pointer capture 버그 수정)
   · ▶ 시간순 비행 애니메이션 (기종별 실루엣: 광동체/협동체/리저널)
   ============================================================ */

interface PointerPosition {
  x: number;
  y: number;
}

interface PanGesture {
  mode: 'pan';
  sx: number;
  sy: number;
  cam0: Camera;
}

interface PinchGesture {
  mode: 'pinch';
  d0: number;
  mid0: PointerPosition;
  cam0: Camera;
  focus: MapPoint;
}

type Gesture = PanGesture | PinchGesture;

interface DragState {
  ptrs: Map<number, PointerPosition>;
  gest: Gesture | null;
  moved: boolean;
}

interface FlightLogChartProps {
  flights: readonly Flight[];
  sourceLabel: string;
  demoMode?: boolean;
  onAddFlight: () => void;
  onOpenRecordManagement: () => void;
  onOpenDataManagement: () => void;
  onEditFlight?: (manualId: string) => void;
  onDeleteFlight?: (manualId: string) => void;
  onExitDemo?: () => void;
}

/* ---------------- 메인 ---------------- */
export default function FlightLogChart({
  flights,
  sourceLabel,
  demoMode = false,
  onAddFlight,
  onOpenRecordManagement,
  onOpenDataManagement,
  onEditFlight,
  onDeleteFlight,
  onExitDemo,
}: FlightLogChartProps) {
  const [year, setYear] = useState<YearFilter>('all');
  const [ftype, setFtype] = useState<FlightFilter>('all');
  const [cam, setCam] = useState<Camera>({ s: 1, cx: W / 2, cy: H / 2 });
  const [selKey, setSelKey] = useState<string | null>(null);
  const [statTab, setStatTab] = useState<StatTab>('국가');
  const [play, setPlay] = useState<PlaybackState>({ on: false, idx: -1, t: 0, hold: 0, holdTotal: 0, speed: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const camRef = useRef<Camera>(cam); camRef.current = cam;
  const dragRef = useRef<DragState>({ ptrs: new Map<number, PointerPosition>(), gest: null, moved: false });
  const followPause = useRef(0);           // 이 시각까지는 카메라 팔로우 양보
  const playRef = useRef<PlaybackProgress>({ idx: -1, t: 0, hold: 0, holdTotal: 0 }); // rAF 루프용 재생 상태 미러
  const trackKeyRef = useRef<string | null>(null); // 현재 추적 중인 구간 식별자(바뀔 때만 world-wrap 오프셋 재계산)
  const worldOffRef = useRef(0);           // 그 구간 동안 고정 사용하는 world-wrap 오프셋(-W/0/+W)

  const zoomAt = useCallback((factor: number, fx?: number, fy?: number) => {
    setCam((c) => {
      const ns = clamp(c.s * factor, S_MIN, S_MAX);
      if (ns === c.s) return c;
      const px0 = fx != null ? fx : c.cx, py0 = fy != null ? fy : c.cy;
      const ncx = px0 + (c.cx - px0) * (c.s / ns);
      const ncy = py0 + (c.cy - py0) * (c.s / ns);
      const nvh = H / ns;
      return { s: ns, cx: normalizeWorldX(ncx), cy: clamp(ncy, nvh / 2, H - nvh / 2) };
    });
  }, []);
  const resetCam = useCallback(() => setCam({ s: 1, cx: W / 2, cy: H / 2 }), []);

  const toMap = useCallback((clientX: number, clientY: number): MapPoint => {
    const el = svgRef.current;
    const c = camRef.current;
    const w0 = W / c.s, h0 = H / c.s;
    const x0 = c.cx - w0 / 2, y0 = clamp(c.cy - h0 / 2, 0, H - h0);
    if (!el) return [c.cx, c.cy];
    const r = el.getBoundingClientRect();
    return [x0 + ((clientX - r.left) / r.width) * w0, y0 + ((clientY - r.top) / r.height) * h0];
  }, []);

  /* 팬/핀치: window 리스너 (capture 미사용 → 클릭 정상 동작) */
  const onWinMove = useCallback((e: PointerEvent) => {
    const D = dragRef.current;
    if (!D.ptrs.has(e.pointerId)) return;
    D.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = D.gest; if (!g) return;
    const el = svgRef.current;
    const rect = el ? el.getBoundingClientRect() : { width: 1, height: 1 };
    if (g.mode === 'pan' && D.ptrs.size === 1) {
      const ddx = e.clientX - g.sx, ddy = e.clientY - g.sy;
      if (Math.abs(ddx) + Math.abs(ddy) > 5) D.moved = true;
      const dxm = ddx * ((W / g.cam0.s) / rect.width);
      const dym = ddy * ((H / g.cam0.s) / rect.height);
      const nvh = H / g.cam0.s;
      setCam({ s: g.cam0.s, cx: normalizeWorldX(g.cam0.cx - dxm), cy: clamp(g.cam0.cy - dym, nvh / 2, H - nvh / 2) });
    } else if (g.mode === 'pinch' && D.ptrs.size >= 2) {
      D.moved = true;
      const pts = [...D.ptrs.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const ns = clamp(g.cam0.s * (d / (g.d0 || 1)), S_MIN, S_MAX);
      const [fx, fy] = g.focus;
      let ncx = fx + (g.cam0.cx - fx) * (g.cam0.s / ns);
      let ncy = fy + (g.cam0.cy - fy) * (g.cam0.s / ns);
      ncx -= (mid.x - g.mid0.x) * ((W / ns) / rect.width);
      ncy -= (mid.y - g.mid0.y) * ((H / ns) / rect.height);
      const nvh = H / ns;
      setCam({ s: ns, cx: normalizeWorldX(ncx), cy: clamp(ncy, nvh / 2, H - nvh / 2) });
    }
  }, []);
  const onWinUp = useCallback((e: PointerEvent) => {
    const D = dragRef.current;
    D.ptrs.delete(e.pointerId);
    if (D.ptrs.size === 0) {
      D.gest = null;
      followPause.current = performance.now() + 2000;
      window.removeEventListener('pointermove', onWinMove);
      window.removeEventListener('pointerup', onWinUp);
      window.removeEventListener('pointercancel', onWinUp);
    } else if (D.ptrs.size === 1) {
      const p = [...D.ptrs.values()][0];
      D.gest = { mode: 'pan', sx: p.x, sy: p.y, cam0: { ...camRef.current } };
    }
  }, [onWinMove]);

  const onPointerDown = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    const D = dragRef.current;
    followPause.current = performance.now() + 2000;
    D.moved = false;
    D.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...D.ptrs.values()];
    const c0 = { ...camRef.current };
    if (pts.length === 1) {
      D.gest = { mode: 'pan', sx: e.clientX, sy: e.clientY, cam0: c0 };
    } else if (pts.length === 2) {
      const d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      D.gest = { mode: 'pinch', d0, mid0: mid, cam0: c0, focus: toMap(mid.x, mid.y) };
    }
    if (D.ptrs.size === 1) {
      window.addEventListener('pointermove', onWinMove);
      window.addEventListener('pointerup', onWinUp);
      window.addEventListener('pointercancel', onWinUp);
    }
  }, [onWinMove, onWinUp, toMap]);

  useEffect(() => () => {
    window.removeEventListener('pointermove', onWinMove);
    window.removeEventListener('pointerup', onWinUp);
    window.removeEventListener('pointercancel', onWinUp);
    dragRef.current.ptrs.clear();
    dragRef.current.gest = null;
  }, [onWinMove, onWinUp]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      followPause.current = performance.now() + 2000;
      const [fx, fy] = toMap(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.25 : 0.8, fx, fy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [flights, toMap, zoomAt]);

  const years = useMemo(() => {
    return availableYears(flights);
  }, [flights]);

  const allDerived = useMemo(() => aggregateFlights(flights), [flights]);

  const archiveRange = useMemo(() => {
    if (years.length === 0) return '날짜 미상';
    const firstYear = years[0];
    const lastYear = years[years.length - 1];
    return firstYear === lastYear ? String(firstYear) : `${firstYear} — ${lastYear}`;
  }, [years]);

  const filtered = useMemo(() => {
    return filterFlights(flights, year, ftype);
  }, [flights, year, ftype]);

  useEffect(() => {
    if (year !== 'all' && !years.includes(year)) setYear('all');
  }, [year, years]);

  useLayoutEffect(() => {
    setSelKey(null);
    playRef.current = { idx: -1, t: 0, hold: 0, holdTotal: 0 };
    trackKeyRef.current = null;
    setPlay((current) => ({
      ...current,
      on: false,
      idx: -1,
      t: 0,
      hold: 0,
      holdTotal: 0,
    }));
  }, [filtered]);

  const derived = useMemo(() => aggregateFlights(filtered), [filtered]);

  /* 애니메이션 시퀀스 (시간순, 좌표 있는 편만) */
  const seq = useMemo(() => chronologicalFlights(filtered), [filtered]);

  /* 재생 루프 + 카메라 팔로우 */
  useEffect(() => { playRef.current = { idx: play.idx, t: play.t, hold: play.hold || 0, holdTotal: play.holdTotal || 0 }; }, [play.idx, play.t, play.hold, play.holdTotal]);

  useEffect(() => {
    if (!play.on) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) * play.speed; last = now;
      const ps = playRef.current;
      const advanced = advancePlayback(ps, dt, seq);
      if (advanced.missingFlight) {
        setPlay((p) => ({ ...p, on: false, idx: -1, t: 0, hold: 0, holdTotal: 0 }));
        return;
      }
      const { idx, t, hold, holdTotal } = advanced.progress;
      const { done } = advanced;
      playRef.current = { idx, t, hold, holdTotal };
      setPlay((p) => (done ? { ...p, on: false, idx, t, hold: 0, holdTotal: 0 } : { ...p, idx, t, hold, holdTotal }));
      /* 카메라 팔로우 — 손 조작 중/직후 2초는 양보. 이동 중엔 현재 위치를 그대로 추적 */
      if (dragRef.current.ptrs.size === 0 && now >= followPause.current) {
        let rawTx = null, fy = 0, sT = 2, trackKey = null;
        if (hold > 0 && seq[idx] && seq[idx + 1]) {
          const curF = seq[idx], nextF = seq[idx + 1];
          const [ax, ay] = quadPoint(arcGeom(curF.fa, curF.ta), 1);
          const nextAirport = AIRPORTS[nextF.fa];
          const [bx, by] = nextAirport ? wrapTowards(ax, nextAirport[0], nextAirport[1]) : [ax, ay];
          const hT = clamp(1 - hold / (holdTotal || 1), 0, 1);
          rawTx = ax + (bx - ax) * hT; fy = ay + (by - ay) * hT;
          /* 전체 환승 구간 길이로 한 번 정한 비행 노선 기준 배율 — 해안 통과 중에도 불변 */
          sT = spanScale(ax, ay, bx, by);
          trackKey = 'h' + idx;
        } else if (seq[idx]) {
          const g = arcGeom(seq[idx].fa, seq[idx].ta);
          const pt = quadPoint(g, clamp(t, 0, 1));
          rawTx = pt[0]; fy = pt[1]; sT = routeScale(g);
          trackKey = 'f' + idx;
        }
        if (rawTx != null) {
          const isNewSegment = trackKey !== trackKeyRef.current;
          if (isNewSegment) {
            trackKeyRef.current = trackKey;
            /* 구간이 바뀔 때만, 지금(camRef) 기준으로 가장 가까운 world-copy를 한 번 정함 */
            worldOffRef.current = nearestWorldOffset(rawTx, camRef.current.cx);
          }
          const targetX = rawTx + worldOffRef.current; /* 구간 내내 같은 오프셋 고정 → 프레임 간 재판단으로 인한 떨림 제거 */
          const isTransferSeg = hold > 0;
          if (isNewSegment) {
            /* 새 구간 시작: 위치는 항상 즉시 스냅(어긋남·떨림 방지).
               환승 배율은 전체 직선 구간 기준값으로 한 번 맞추고, 비행은 이전 배율에서 서서히 근접 시작 */
            setCam((c) => {
              const ns = isTransferSeg ? sT : c.s;
              const nvh = H / ns;
              return { s: ns, cx: targetX, cy: clamp(fy, nvh / 2, H - nvh / 2) };
            });
          } else {
            setCam((c) => {
              let ns = c.s + (sT - c.s) * 0.5; /* 겹치는 시간을 최대한 짧게(약 0.15초) → 흔들림 유발 구간 최소화 */
              if (Math.abs(ns - sT) < 0.01) ns = sT;
              const nvh = H / ns;
              const targetY = clamp(fy, nvh / 2, H - nvh / 2);
              const L = 0.14;
              const ncx = c.cx + (targetX - c.cx) * L;
              const ncy = c.cy + (targetY - c.cy) * L;
              if (Math.abs(ncx - c.cx) < 0.05 && Math.abs(ncy - c.cy) < 0.05 && ns === c.s) return c;
              return { s: ns, cx: ncx, cy: ncy };
            });
          }
        }
      }
      if (!done) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [play.on, play.speed, seq]);

  const playActive = play.idx >= 0;
  const playedKeys = useMemo(
    () => (playActive ? playedRouteKeys(seq, play.idx) : null),
    [playActive, play.idx, seq],
  );
  const curFlight = playActive ? seq[Math.min(play.idx, seq.length - 1)] : null;
  const curKey = curFlight ? routeKey(curFlight.fa, curFlight.ta) : null;

  /* 재생 중 "지금까지" 누적 통계 — 편수/거리는 현재 편의 진행률(t)만큼 부분 반영, 국가·공항은 스친 순간 바로 반영 */
  /* 재생 중 "지금까지" 누적 통계 + 순위용 세부 집계 — derived와 동일한 방식으로 seq[0..idx]만 대상 */
  const liveDerived = useMemo(
    () => (playActive ? aggregateLiveFlights(seq, play.idx, play.t) : null),
    [playActive, play.idx, play.t, seq],
  );

  const rankData = useMemo(
    () => rankingData(liveDerived || derived, statTab),
    [derived, liveDerived, statTab],
  );

  /* 지금 재생 중인 편이 어느 순위 항목을 늘리고 있는지 — 해당 막대를 황금색으로 표시 */
  const liveActiveNames = useMemo(
    () =>
      liveDerived && curFlight
        ? activeRankingNames(liveDerived, curFlight, statTab)
        : null,
    [liveDerived, curFlight, statTab],
  );

  const topLabels = useMemo(() => topAirportLabels(derived), [derived]);
  const sel = selKey && !playActive ? derived.routes.get(selKey) ?? null : null;
  const selDist = useMemo(
    () =>
      sel && AIRPORTS[sel.a] && AIRPORTS[sel.b]
        ? Math.round(haversine(knownAirport(sel.a), knownAirport(sel.b)))
        : null,
    [sel],
  );

  const handleArcClick = useCallback((key: string) => {
    if (dragRef.current.moved || playActive) return;
    setSelKey((cur) => (cur === key ? null : key));
  }, [playActive]);

  const handleMapBackgroundClick = useCallback(() => {
    if (!dragRef.current.moved && !playActive) setSelKey(null);
  }, [playActive]);

  const closeRouteDetail = useCallback(() => setSelKey(null), []);
  const zoomIn = useCallback(() => zoomAt(1.5), [zoomAt]);
  const zoomOut = useCallback(() => zoomAt(1 / 1.5), [zoomAt]);

  const togglePlayback = useCallback(() => {
    if (seq.length === 0) return;
    if (play.on) {
      setPlay((current) => ({ ...current, on: false }));
      return;
    }

    setSelKey(null);
    followPause.current = 0;
    const resume = play.idx >= 0 && !(play.idx === seq.length - 1 && play.t >= 1);
    if (!resume) {
      const firstFlight = seq[0];
      const geometry = arcGeom(firstFlight.fa, firstFlight.ta);
      const targetX = normalizeWorldX(geometry.x1);
      const scale = routeScale(geometry);
      setCam(() => {
        const viewHeight = H / scale;
        return {
          s: scale,
          cx: targetX,
          cy: clamp(geometry.y1, viewHeight / 2, H - viewHeight / 2),
        };
      });
      playRef.current = { idx: -1, t: 0, hold: 0, holdTotal: 0 };
      trackKeyRef.current = null;
      setPlay((current) => ({
        ...current,
        on: true,
        idx: -1,
        t: 0,
        hold: 0,
        holdTotal: 0,
      }));
      return;
    }

    playRef.current = {
      idx: play.idx,
      t: play.t,
      hold: play.hold || 0,
      holdTotal: play.holdTotal || 0,
    };
    setPlay((current) => ({ ...current, on: true }));
  }, [play.hold, play.holdTotal, play.idx, play.on, play.t, seq]);

  const stopPlayback = useCallback(() => {
    trackKeyRef.current = null;
    setPlay((current) => ({
      ...current,
      on: false,
      idx: -1,
      t: 0,
      hold: 0,
      holdTotal: 0,
    }));
  }, []);

  const cyclePlaybackSpeed = useCallback(() => {
    setPlay((current) => ({
      ...current,
      speed: current.speed === 1 ? 2 : current.speed === 2 ? 4 : 1,
    }));
  }, []);

  const summaryMetrics = {
    flightCount: liveDerived ? liveDerived.count : filtered.length,
    internationalCount: liveDerived ? liveDerived.intl : derived.intl,
    domesticCount: liveDerived ? liveDerived.dom : derived.dom,
    distanceKm: liveDerived ? liveDerived.km : derived.km,
    countryCount: liveDerived ? liveDerived.countries : derived.countries.size,
    airportCount: liveDerived ? liveDerived.airports : derived.apUse.size,
  };
  const filterActive = year !== 'all' || ftype !== 'all';
  const summaryLabel = liveDerived
    ? '여정 재생 중'
    : filterActive
      ? '선택한 기록'
      : '전체 기록';

  /* -------- 대시보드 -------- */
  return (
    <main className="flc-app">
      <div className="flc-shell">
        <header className="flc-site-header">
          <div className="flc-header-bar">
            <div className="flc-eyebrow">PERSONAL FLIGHT LOG</div>
            <nav className="flc-header-nav" aria-label="페이지 섹션">
              <a className="flc-text-link" href="#world-map">WORLD MAP</a>
              <a className="flc-text-link" href="#insights">RANKINGS</a>
              <a className="flc-text-link" href="#flight-archive">ARCHIVE</a>
            </nav>
            <div className="flc-header-actions">
              {demoMode && onExitDemo && (
                <button className="flc-btn" type="button" onClick={onExitDemo}>
                  샘플 종료
                </button>
              )}
              <button className="flc-btn flc-btn-primary" type="button" onClick={onAddFlight}>
                + 비행 추가
              </button>
              <button className="flc-btn" type="button" onClick={onOpenRecordManagement}>
                기록 관리
              </button>
              <button className="flc-btn" type="button" onClick={onOpenDataManagement}>
                데이터 관리
              </button>
            </div>
          </div>

          <div className="flc-header-identity">
            <div>
              <h1 className="flc-header-title" id="flight-log-title" tabIndex={-1}>나의 비행 기록</h1>
              <p className="flc-source-name">{sourceLabel}</p>
            </div>
            <div className="flc-year-range" aria-label={`기록 기간 ${archiveRange}`}>
              <strong>{archiveRange}</strong>
              <span>
                {flights.length.toLocaleString()} FLIGHTS ·{' '}
                {allDerived.km.toLocaleString()} KM
              </span>
            </div>
          </div>
        </header>

        {demoMode && (
          <div className="flc-demo-banner" role="status">
            합성 샘플을 임시로 보고 있습니다. 샘플 기록은 브라우저 저장소에 저장되지 않습니다.
          </div>
        )}

        <section className="flc-filter-panel" aria-labelledby="filter-heading">
          <div className="flc-filter-heading">
            <h2 id="filter-heading">기록 필터</h2>
            <span>ARCHIVE FILTER</span>
          </div>
          <div className="flc-filter-row">
            <span className="flc-filter-label" id="year-filter-label">YEAR</span>
            <div
              className="flc-filter-options flc-filter-years flc-scroll"
              aria-labelledby="year-filter-label"
            >
              <Chip on={year === 'all'} onClick={() => setYear('all')}>전체</Chip>
              {years.map((availableYear) => (
                <Chip
                  key={availableYear}
                  on={year === availableYear}
                  onClick={() => setYear(availableYear)}
                >
                  {availableYear}
                </Chip>
              ))}
            </div>
          </div>
          <div className="flc-filter-row">
            <span className="flc-filter-label" id="type-filter-label">TYPE</span>
            <div
              className="flc-filter-options flc-filter-types"
              aria-labelledby="type-filter-label"
            >
              {(['all', '국제선', '국내선'] as const).map((type) => (
                <Chip key={type} on={ftype === type} onClick={() => setFtype(type)}>
                  {type === 'all' ? '국제+국내' : type}
                </Chip>
              ))}
            </div>
          </div>
        </section>

        <section className="flc-summary-section" aria-labelledby="summary-heading">
          <div className="flc-summary-label">
            <h2 id="summary-heading">나의 비행 숫자</h2>
            <span>{summaryLabel.toUpperCase()}</span>
          </div>
          {filtered.length === 0 && (
            <div className="flc-empty-state" role="status">
              현재 필터에 해당하는 비행이 없습니다. 연도나 노선 유형을 바꿔보세요.
            </div>
          )}
          <SummaryStatistics
            metrics={summaryMetrics}
            showTypeBreakdown={ftype === 'all'}
            live={liveDerived != null}
          />
        </section>

        <div className="flc-map-rankings-grid">
        <section
          className="flc-section flc-map-column"
          id="world-map"
          aria-labelledby="map-heading"
        >
          <header className="flc-section-heading">
            <div>
              <div className="flc-eyebrow">WORLD FLIGHT MAP</div>
              <h2 id="map-heading">나의 세계 지도</h2>
            </div>
            <p>
              노선을 선택해 기록을 열고, 지도를 움직이거나 확대해 여행의 궤적을 살펴보세요.
              재생 버튼을 누르면 가장 오래된 비행부터 시간이 흐릅니다.
            </p>
          </header>

          <FlightMap
            svgRef={svgRef}
            camera={cam}
            analytics={derived}
            topLabels={topLabels}
            selectedKey={selKey}
            selectedRoute={sel}
            selectedDistanceKm={selDist}
            play={play}
            playActive={playActive}
            playedKeys={playedKeys}
            currentFlight={curFlight}
            currentRouteKey={curKey}
            sequence={seq}
            onPointerDown={onPointerDown}
            onBackgroundClick={handleMapBackgroundClick}
            onRouteClick={handleArcClick}
            onCloseRoute={closeRouteDetail}
            onTogglePlayback={togglePlayback}
            onStopPlayback={stopPlayback}
            onCycleSpeed={cyclePlaybackSpeed}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onResetCamera={resetCam}
          />

          {derived.unknown.length > 0 && (
            <div className="flc-warning" role="status">
              좌표 미등록 공항:{' '}
              <b className="flc-mono">{derived.unknown.join(', ')}</b> — 기록과 통계에는
              포함되며 지도·거리·애니메이션에서만 제외됩니다.
            </div>
          )}

          <p className="flc-map-note">
            PLAY MY JOURNEY 재생 시 카메라는 노선 길이에 맞춰 배율을 조절하고 비행기를
            따라갑니다. 지도를 직접 움직이면 2초 뒤 자동 추적을 다시 시작합니다. 연결되지
            않은 구간은 공항 사이의 직선과 단순화된 해안선을 바탕으로 지상·해상 이동을
            구분한 시각적 표현이며, 실제 교통수단이나 이동 경로를 뜻하지 않습니다.
          </p>
        </section>

        <section
          className="flc-section flc-rankings-column"
          id="insights"
          aria-labelledby="insights-heading"
        >
          <header className="flc-section-heading">
            <div>
              <div className="flc-eyebrow">RANKINGS</div>
              <h2 id="insights-heading">순위</h2>
            </div>
            <p>
              국가·도시·공항·운항사 순위는 기존 집계 방식 그대로, 현재 선택한 기록을
              기준으로 보여줍니다.
            </p>
          </header>
          <RankingsPanel
            tab={statTab}
            onTabChange={setStatTab}
            rankings={rankData}
            activeNames={liveActiveNames}
            live={liveDerived != null}
          />
        </section>
        </div>

        <div className="flc-section" id="flight-archive">
          <FlightTimeline
            flights={filtered}
            onEditFlight={demoMode ? undefined : onEditFlight}
            onDeleteFlight={demoMode ? undefined : onDeleteFlight}
          />
        </div>

        <footer className="flc-footer">
          <div>
            <strong>METHOD</strong>
            해안선은 간결하게 표현한 사용자 정의 SVG 지도입니다. 비행 거리는 등록된
            공항 좌표 사이의 대권거리 추정치이며 실제 운항 거리와 다를 수 있습니다.
          </div>
          <div>
            <strong>LOCAL &amp; PRIVATE</strong>
            개인 비행 기록은 이 브라우저의 IndexedDB에 저장되며 서버나 계정으로 전송되지
            않습니다. 브라우저 또는 사이트 데이터를 지우면 기록도 사라질 수 있으므로 JSON
            백업을 정기적으로 보관하세요.
          </div>
        </footer>
      </div>
    </main>
  );
}
