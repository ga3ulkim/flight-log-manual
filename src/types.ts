export type FlightType = '국내선' | '국제선';
export type FlightFilter = 'all' | FlightType;
export type YearFilter = 'all' | number;
export type StatTab = '국가' | '도시' | '공항' | '항공사';
export type IataCode = string;
export type RouteKey = string;

export interface Flight {
  id: number;
  /** Stable manual-record identity for CRUD; absent for demo/legacy rows. */
  manualId?: string;
  /** Legacy-import provenance; fallback means the parser lacked safe evidence. */
  typeSource?: 'explicit' | 'countries' | 'fallback';
  type: FlightType;
  fc: string;
  tc: string;
  fcity: string;
  tcity: string;
  fa: IataCode;
  ta: IataCode;
  al: string;
  nat: string;
  fn: string;
  ac: string;
  d: string;
  y: number | null;
  /** User-entered local wall-clock time at the departure airport. */
  departureTime?: string;
  /** Point-in-time IANA zone snapshots for timezone-aware derived timing. */
  departureTimeZoneId?: string;
  arrivalTimeZoneId?: string;
  /** Stable carrier codes only when a local autocomplete result was selected. */
  airlineIata?: string;
  airlineIcao?: string;
  sortKey: string;
}

export interface DateInfo {
  y: number | null;
  d: string;
  departureTime?: string;
  sortKey: string;
}

export interface Camera {
  s: number;
  cx: number;
  cy: number;
}

export interface PlaybackState {
  on: boolean;
  idx: number;
  t: number;
  hold: number;
  holdTotal: number;
  speed: 1 | 2 | 4;
}

export type PlaybackProgress = Pick<
  PlaybackState,
  'idx' | 't' | 'hold' | 'holdTotal'
>;

export interface AirportUsage {
  n: number;
  city: string;
}

export interface RouteRecord {
  a: IataCode;
  b: IataCode;
  n: number;
  intl: boolean;
  items: Flight[];
}

export interface FlightAnalytics {
  routes: Map<RouteKey, RouteRecord>;
  apUse: Map<IataCode, AirportUsage>;
  unknown: IataCode[];
  km: number;
  intl: number;
  dom: number;
  countries: Set<string>;
  cities: Map<string, number>;
  cCount: Map<string, number>;
  alCount: Map<string, number>;
}

export interface LiveFlightAnalytics {
  count: number;
  km: number;
  countries: number;
  airports: number;
  intl: number;
  dom: number;
  apUse: Map<IataCode, AirportUsage>;
  cCount: Map<string, number>;
  cities: Map<string, number>;
  alCount: Map<string, number>;
}

export type RankingEntry = readonly [name: string, count: number];

export interface ParseResult {
  flights: Flight[];
  err: string | null;
}
