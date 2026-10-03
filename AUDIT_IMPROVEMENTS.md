# Repository audit 후속 개선 결과

2026-10-03 기준. Audit의 지적을 현재 코드와 실행 결과로 다시 확인한 뒤 적용했다. 새 dependency, 저장소 migration, framework 교체, remote push·merge·release·deploy는 수행하지 않았다.

## 해결한 문제와 주요 변경 영역

| 문제 | 수정 | 코드·검증 위치 |
| --- | --- | --- |
| Excel 날짜 셀과 슬래시 날짜가 가져오기에서 사라짐 | XLS/XLSX의 숫자 날짜를 1900/1904 날짜 체계에 맞춰 달력 값으로 읽는다. 날짜만 있는 셀에 시간을 만들지 않으며 명시적인 자정은 보존한다. CSV는 문자열로 읽어 편명의 앞자리 0을 유지한다. | `src/lib/parser.ts`, `fileParser.ts`, `dateIata.ts`, `parser.test.ts` |
| 공항 정보를 직접 편집하면 시간대 유실 | 이름·도시·국가 표시 정보 편집에는 기존 zone을 보존한다. IATA 또는 실제 좌표 변경 시에는 오래된 zone을 제거한다. 동등한 좌표 표기 변경은 보존한다. | `src/lib/manualAirportFields.ts`, 해당 테스트, `FlightEditorDialog.tsx` |
| 가져오기에서 제외된 행이 조용히 사라짐 | 파서의 원본 행 번호와 진단을 유지하고, 최종 저장과 같은 domain validation으로 미리보기에서 가져오기·제외 개수와 사유를 보여준다. 오류가 있는 행만 제외하며 중복 비행은 유지한다. 예상하지 못한 실패는 전체 작업을 중단한다. | `parser.ts`, `manualImport.ts`, `manualImport.test.ts`, `DataManagementDialog.tsx` |
| JSON 읽기 중 중첩 선택·닫기가 가능함 | JSON과 CSV/Excel 읽기를 하나의 동기적인 ref 잠금으로 직렬화하고, 읽는 동안 버튼·닫기를 잠근다. unmount 후 완료 결과는 반영하지 않는다. | `DataManagementDialog.tsx` |
| 같은 IATA의 좌표가 다르면 거리·시간·재생 불일치 | 기록의 저장 좌표를 공통 resolver로 읽어 총거리, 실시간 거리, 예상 시간, 재생 길이, 활성 노선, 항공기, 카메라, 환승에 사용한다. 명시적으로 없는 좌표를 다른 기록에서 가져오지 않는다. | `geography.ts`, `analytics.ts`, `flightTiming.ts`, `playback.ts`, 지도·재생 component, `flightSnapshotConsistency.test.ts`, `FlightMap.test.tsx` |
| 국가 표시명이 다르면 방문 국가가 중복됨 | 저장된 ISO 국가 코드로 집계하고 표시 이름은 별도로 유지한다. 전체/실시간 순위와 현재 국가 강조도 같은 이름을 사용한다. 국가 코드가 없는 기존 데이터는 기존 표시명을 사용한다. | `analytics.ts`, `types.ts`, `analytics.test.ts` |
| 환승 시작 때 전체 진행률이 뒤로 내려감 | 환승 동안 완료된 비행의 진행률을 유지한다. 다음 비행부터 다시 증가한다. | `PlaybackUI.tsx`, `FlightTimingPresentation.test.tsx` |
| 화면 변환마다 domain·시간대 검증 반복 | 이 domain module이 검증하고 깊게 동결한 객체만 WeakSet으로 식별해 변환 시 재검증을 생략한다. 외부 객체는 동결되어 있어도 검증한다. 부모가 변환·정렬 결과를 entry/archive/삭제에 공유한다. | `manualFlight.ts`, `ManualFlightApp.tsx`, `ManualEntryView.tsx`, domain·repository 테스트 |
| 작은 파일도 거대한 시트 범위로 확장 가능 | CSV/Excel은 최대 20,000개 데이터 행, 물리적 시트 20,012행, 256열, 1,000,000칸으로 제한한다. Excel은 첫 시트만 읽고 sentinel 행으로 제한 초과를 감지한다. 일부만 저장하지 않고 오류를 낸다. | `parser.ts`, `fileParser.ts`, 제한 경계·희소 시트·초과 CSV 테스트 |
| PR에서 검증 workflow가 실행되지 않음 | `pull_request`용 lint/test/typecheck/build workflow를 추가했다. contents 읽기 권한만 있고 배포 단계는 없다. 기존 workflow의 action SHA를 재사용한다. | `.github/workflows/validate.yml` |
| updater가 네트워크에서 무기한 대기 | HTTP 다운로드·쿼리에 60초 timeout을 적용했다. Wikidata는 일시적 네트워크/HTTP 실패만 최대 3회 재시도하며 응답 body를 해제한다. 영구 HTTP 오류·잘못된 JSON은 재시도하지 않는다. 유지보수 job은 30분으로 제한한다. | `scripts/lib/wikidata-request.mjs`, 해당 테스트, updater 2개, 유지보수 workflow 2개 |

추가로 제목에 ‘출발·도착’이 있으면 실제 헤더 탐색이 중단되는 오류를 재현해 수정했다. 열 매핑은 후보 행마다 새로 만들고 실제 출발·도착 공항 열이 모두 있는 행만 헤더로 인정한다.

## 그대로 유지하거나 보류한 항목

- **지도 대표 좌표 정책:** earliest saved usable snapshot을 쓰는 기존 정책과 테스트는 유지했다. 묶음 노선·공항 위치는 대표 위치이며, 기록별 수치·활성 재생은 각 기록의 위치다. 차이가 있을 때만 안내한다. 과거 공항의 위치를 임의로 통합하거나 사용자 데이터를 변경하지 않는다.
- **큰 component 분해 / clean architecture / 전역 좌표 상태 교체:** 파일 길이만으로 얻을 이익이 명확하지 않고 회귀 범위가 커 이번에는 적용하지 않았다.
- **Worker·대규모 cache·매 프레임 UI 분리:** 변환 비용은 측정하고 해결했지만 DOM rendering/프레임 비용을 브라우저 profiler로 정량 확인하지 못했다. 대량 파일의 파싱·domain 검증은 여전히 main thread에서 수행한다. 제한은 완화책이며 완전한 성능 해결은 아니다.
- **사용하지 않는 merge helper와 오래된 CSS 일괄 정리:** 현재 correctness를 개선하지 않는 Low priority 정리는 보류했다. 이번에 서로 다른 좌표 resolver와 중복 화면 변환은 실제 오류·비용이 있었으므로 통합했다.
- **전체 UI/E2E 체계 도입:** 새 테스트 framework를 설치하지 않았다. 위험한 변환 경로에는 집중된 regression/integration 테스트를 추가했으며 실제 브라우저 확인은 별도로 수행했다.

## 검증 결과

- 최초 기준: 27개 테스트 파일, 236개 테스트 통과. 최종: **30개 파일, 265개 테스트 모두 통과**. 기존 기대값을 바꿔 실패를 숨기지 않았다.
- Node 22.22.0에서 전체 Vitest, app/tool TypeScript 검사, ESLint 통과. Vitest는 로컬 cache 쓰기를 피하려고 `--configLoader native --no-cache`를 사용했다.
- Node 22.22.0에서 실제 Vite production build 통과. `write: false`로 번들을 생성·검사해 기존 `dist`를 덮어쓰지 않았다.
- 변경 diff와 whitespace 검사 통과. 테스트 이름 중복 확인 및 정리 완료. workflow YAML, 고정 action SHA, PR 읽기 권한 확인 통과. GitHub의 원격 workflow 실행은 수행하지 않았다.
- 새 integration 테스트는 합성 CSV의 파싱 → 제외 행 진단 → domain 변환 → repository merge까지 실행한다. 원본 5개 행 중 오류 3개를 제외하고 같은 비행 2개를 서로 다른 ID로 저장하며 시각과 편명 `0012`를 보존한다.
- 브라우저에서 실제 기록 추가, 공항 이름 직접 수정·저장, 데이터 관리 열기 및 JSON 내보내기 성공 안내를 확인했다. 최종 코드의 합성 샘플은 지도·통계·순위·타임라인을 표시했고 여정 재생이 4/4, 진행률 100%, 총거리 3,347km로 완료됐다. 이 확인은 자동 UI regression suite를 대체하지 않는다.
- 브라우저 도구의 file chooser와 download event가 응답하지 않아 파일 선택부터 복원/가져오기까지의 UI E2E, 실제 내려받은 파일 내용은 검증 완료로 취급하지 않았다. 날짜·시간 필드의 자동 입력 반영도 확인하지 못했다. 해당 값의 domain·파일 변환은 테스트로 검증했다.
- 실제 외부 메타데이터 갱신, 새 npm install, live credential 사용은 하지 않았다. 이전 audit의 dependency advisory endpoint 접근 실패도 해소했다고 주장하지 않는다.

검증 명령은 `node node_modules/vitest/vitest.mjs run --configLoader native --no-cache`, `node node_modules/typescript/bin/tsc --project tsconfig.app.json --noEmit --incremental false`, 같은 명령의 `tsconfig.node.json`, `node node_modules/eslint/bin/eslint.js .`이다. Node 22 실행은 로컬 `.tools/node-v22.22.0-win-x64/node.exe`를 사용했다.

## 성능 측정

Windows / Node 24.19.0, 동일 synthetic records, 시간·IANA zone 포함, esbuild in-memory bundle에서 측정했다. 기록 생성은 측정에서 제외했고 작업별 3회 warm-up 후 7회 중 중앙값을 비교했다. 개선 전후에 같은 측정 코드를 사용했다.

| 작업 | 기록 수 | 전 | 후 |
| --- | ---: | ---: | ---: |
| 시각화 데이터 변환 | 1,000 | 46.77ms | 0.46ms |
| 시각화 데이터 변환 | 5,000 | 260.18ms | 0.87ms |
| entry 목록 변환·정렬 | 5,000 | 325.12ms | 2.36ms |

이는 데이터 준비의 CPU 비용 감소다. 브라우저 rendering 시간 또는 전체 가져오기 시간이 같은 비율로 줄었다는 뜻은 아니다. 실제 DOM 비용은 후속 profiling 대상이다.

최종 초기 JS gzip은 221,294 bytes로 audit 기준 220,256 bytes 대비 약 1KB 증가했다. 검색 데이터와 CSS 크기는 동일하며 파일 파서 chunk는 계속 lazy load한다.

## 호환성과 데이터 영향

- JSON V1/V2 복원, V2 출력 schema, stable ID, 생성·수정 시각, 병합/교체의 원자적 검증, 현재 페이지 메모리 저장 정책을 유지한다. 저장 형식 migration은 없다.
- CSV/Excel 가져오기는 유효한 행을 새 ID로 추가하고 동일 노선을 자동 deduplicate하지 않는다. 빈 행은 데이터 개수에서 제외한다. ISO 국가 코드는 내부 통계 identity로만 사용한다.
- 새로고침 시 기록 초기화, 명시적 archive 진입, 단건 삭제와 bulk clear/replace 확인 정책은 유지한다.
- 의도된 제한 변경: 과도하게 큰 CSV/Excel은 명시적으로 거부한다. 파일 분할·불필요한 열/행 제거가 필요하며 기존 기록은 변경되지 않는다. JSON 백업의 기존 50MB 제한은 유지한다.
- 개인 참조 파일, 기존 IndexedDB, 사용자 백업은 읽거나 수정·삭제하지 않았다. 테스트 파일은 합성 데이터만 사용했다.

## 남은 확인과 후속 작업

- [ ] 실제 Chrome/Edge에서 날짜·시간 직접 입력 → 저장 → 수정 → JSON 내보내기 → 새로고침 → 복원 round-trip 확인.
- [ ] 공항 이름만 바꾼 뒤 JSON의 `timezoneId`가 유지되는지, IATA/좌표 변경 시 제거되는지 확인.
- [ ] JSON 읽기 중 재선택·닫기 차단, 부모에 의한 unmount, 파일 읽기 실패 후 재선택을 deferred promise 기반 UI 테스트로 보호.
- [ ] 혼합 유효/오류 CSV·XLS·XLSX의 원본 행 번호·사유·확인 개수·최종 추가 개수 UI를 확인. 모두 오류인 파일도 확인.
- [ ] 다운로드된 JSON/CSV를 실제 다시 읽어 비교하고, replace 취소·병합·bulk clear 확인 및 키보드 focus를 확인.
- [ ] 큰 파일/5,000개 이상 기록에서 browser Performance/React Profiler로 long task·rendering·heap을 먼저 측정. 필요할 때 parsing/validation chunking 또는 Worker와 정적 timeline memoization을 각각 최소 범위로 적용.
- [ ] 다른 좌표를 갖는 같은 IATA, 날짜 변경선, 연결/비연결 환승, 속도 변경·일시정지·필터 변경을 실제 지도에서 확인. 대표 공항 정책을 바꾸려면 별도 제품 결정을 먼저 받는다.
- [ ] 네트워크 접근이 가능한 환경에서 dependency advisory 검사와 updater 실제 HTTP 실행, GitHub PR CI 실행을 확인. dependency 변경은 검증된 취약점·호환성 근거가 있을 때 별도로 진행.

검증되지 않은 항목은 위와 같이 분리했으며, 이번 수정은 저장 데이터 삭제·migration 없이 되돌릴 수 있는 Git working tree 변경으로 남겨두었다.
