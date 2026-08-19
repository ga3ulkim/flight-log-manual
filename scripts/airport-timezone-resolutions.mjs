/**
 * Reviewed choices for coordinates where timezone-boundary-builder reports
 * more than one valid zone. The updater fails on any new ambiguity so changes
 * remain explicit and reviewable.
 *
 * Product policy for Xinjiang airport records is the Beijing-time convention
 * represented by Asia/Shanghai; Asia/Urumqi remains a real locally observed
 * alternative but one snapshot must be chosen. Product policy for disputed
 * SUI is its current Moscow-time airport convention, represented by
 * Europe/Moscow. These are explicit choices, never resolver-order fallbacks.
 */
export const AMBIGUOUS_AIRPORT_TIMEZONE_SELECTIONS = Object.freeze({
  AAT: 'Asia/Shanghai',
  ACF: 'Asia/Shanghai',
  AKU: 'Asia/Shanghai',
  BPL: 'Asia/Shanghai',
  DHH: 'Asia/Shanghai',
  FYN: 'Asia/Shanghai',
  HJB: 'Asia/Shanghai',
  HMI: 'Asia/Shanghai',
  HQL: 'Asia/Shanghai',
  HTN: 'Asia/Shanghai',
  IQM: 'Asia/Shanghai',
  JBK: 'Asia/Shanghai',
  KCA: 'Asia/Shanghai',
  KHG: 'Asia/Shanghai',
  KJI: 'Asia/Shanghai',
  KRL: 'Asia/Shanghai',
  KRY: 'Asia/Shanghai',
  NLT: 'Asia/Shanghai',
  QSZ: 'Asia/Shanghai',
  RQA: 'Asia/Shanghai',
  SHF: 'Asia/Shanghai',
  SUI: 'Europe/Moscow',
  SXJ: 'Asia/Shanghai',
  TCG: 'Asia/Shanghai',
  TLQ: 'Asia/Shanghai',
  TWC: 'Asia/Shanghai',
  URC: 'Asia/Shanghai',
  WRH: 'Asia/Shanghai',
  YIN: 'Asia/Shanghai',
  YTW: 'Asia/Shanghai',
  ZFL: 'Asia/Shanghai',
});
