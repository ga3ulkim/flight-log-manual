import {
  type ChangeEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';
import {
  createManualFlightBackup,
  manualBackupFileName,
  parseManualFlightBackup,
  serializeManualFlightBackup,
  type ManualBackupRestoreMode,
  type ManualBackupRestoreResult,
  type ManualFlightBackup,
} from '../../lib/manualBackup';
import {
  exportManualFlightsCsv,
  manualCsvFileName,
} from '../../lib/manualCsv';
import type { ManualFlightRecord } from '../../lib/manualFlight';
import type { Flight } from '../../types';
import { ConfirmDialog } from './ConfirmDialog';
import { DialogShell } from './DialogShell';

type MaybePromise<T> = T | Promise<T>;
type ActiveOperation = 'restore' | 'legacy' | 'clear' | null;
type PendingConfirmation = 'replace' | 'legacy' | 'clear' | null;

export interface LegacyFlightImportRequest {
  sourceFileName: string;
  /** Validated legacy parser output. The parent converts and writes it. */
  flights: readonly Flight[];
}

export interface LegacyFlightImportResult {
  added: number;
  skipped?: number;
  total?: number;
}

export interface DataManagementDialogProps {
  open: boolean;
  records: readonly ManualFlightRecord[];
  onRequestClose: () => void;
  /** Receives a fully validated backup and the user's explicit merge/replace choice. */
  onRestoreBackup: (
    backup: ManualFlightBackup,
    mode: ManualBackupRestoreMode,
  ) => MaybePromise<ManualBackupRestoreResult | void>;
  /** Legacy rows are previewed first and should be added as new manual records. */
  onImportLegacy: (
    request: LegacyFlightImportRequest,
  ) => MaybePromise<LegacyFlightImportResult | void>;
  onClearAll: () => MaybePromise<void>;
}

interface LegacyPreview {
  sourceFileName: string;
  flights: readonly Flight[];
}

const MAX_LOCAL_FILE_BYTES = 50 * 1024 * 1024;

export const MANUAL_CLEAR_ALL_CONFIRMATION = Object.freeze({
  title: '모든 비행 기록을 삭제할까요?',
  description: '현재 세션의 수동 비행 기록이 모두 삭제되며, JSON 백업 없이는 되돌릴 수 없습니다.',
  confirmLabel: '현재 기록 삭제',
  requiredText: '모두 삭제',
});

export const MANUAL_SESSION_DATA_COPY = Object.freeze({
  privacy: '비행 기록은 현재 페이지가 열려 있는 동안만 메모리에 유지됩니다. 새로고침하거나 페이지를 다시 열면 초기화됩니다. 계정이나 백엔드가 없고 비행 기록을 자동 전송하지 않으므로, 기록을 남겨두려면 JSON 백업 또는 CSV 내보내기를 사용하세요.',
  restore: '파일을 먼저 검사한 뒤 현재 세션에만 불러옵니다. 새로고침하면 복원한 기록도 초기화됩니다.',
  legacyImport: '이전 파일을 로컬에서 읽어 현재 세션에만 추가합니다. 새로고침하면 가져온 기록도 초기화됩니다.',
});

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : '작업을 완료하지 못했습니다. 파일과 현재 세션 기록을 확인해 주세요.';
}

function downloadText(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function displayDateOnly(value: string): string {
  return value.replace(/-/g, '.');
}

function displayInstant(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function backupDateRange(backup: ManualFlightBackup): string {
  if (!backup.flights.length) return '비행 기록 없음';
  const dates = backup.flights.map((flight) => flight.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last
    ? displayDateOnly(first)
    : `${displayDateOnly(first)} — ${displayDateOnly(last)}`;
}

function restoreStatus(
  result: ManualBackupRestoreResult | void,
  mode: ManualBackupRestoreMode,
  incomingCount: number,
): string {
  if (!result) {
    return mode === 'replace'
      ? `${incomingCount}개 기록으로 현재 보관함을 대체했습니다.`
      : `${incomingCount}개 백업 기록의 병합을 완료했습니다.`;
  }
  if (mode === 'replace') return `${result.total}개 기록으로 보관함을 대체했습니다.`;
  return `병합 완료: ${result.added}개 추가, ${result.updated}개 갱신, ${result.skipped}개 유지`;
}

function legacyStatus(result: LegacyFlightImportResult | void, incomingCount: number): string {
  if (!result) return `${incomingCount}개 기존 기록을 가져왔습니다.`;
  const skipped = result.skipped ?? 0;
  return skipped
    ? `${result.added}개 추가, ${skipped}개 건너뜀`
    : `${result.added}개 기록을 추가했습니다.`;
}

interface DataSectionProps {
  eyebrow: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
  tone?: 'default' | 'danger';
}

function DataSection({
  eyebrow,
  title,
  description,
  children,
  tone = 'default',
}: DataSectionProps) {
  return (
    <section className={`manual-data-section manual-data-section--${tone}`}>
      <div className="manual-data-section__heading">
        <span>{eyebrow}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="manual-data-section__actions">{children}</div>
    </section>
  );
}

export function DataManagementDialog(props: DataManagementDialogProps) {
  if (!props.open) return null;
  return <DataManagementDialogSession {...props} />;
}

function DataManagementDialogSession({
  records,
  onRequestClose,
  onRestoreBackup,
  onImportLegacy,
  onClearAll,
}: DataManagementDialogProps) {
  const jsonInputId = useId();
  const legacyInputId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [backupPreview, setBackupPreview] = useState<ManualFlightBackup | null>(null);
  const [backupFileName, setBackupFileName] = useState('');
  const [restoreMode, setRestoreMode] = useState<ManualBackupRestoreMode>('merge');
  const [legacyPreview, setLegacyPreview] = useState<LegacyPreview | null>(null);
  const [legacyParsing, setLegacyParsing] = useState(false);
  const [operation, setOperation] = useState<ActiveOperation>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>(null);
  const [status, setStatus] = useState('');
  const [actionError, setActionError] = useState('');
  const busy = operation !== null || legacyParsing;
  const currentIds = new Set(records.map((record) => record.id));
  const overlapCount = backupPreview?.flights.reduce(
    (count, flight) => count + (currentIds.has(flight.id) ? 1 : 0),
    0,
  ) ?? 0;

  const prepareAction = () => {
    setStatus('');
    setActionError('');
  };

  const exportJson = () => {
    prepareAction();
    try {
      const now = new Date();
      const backup = createManualFlightBackup(records, () => now);
      downloadText(
        serializeManualFlightBackup(backup),
        manualBackupFileName(now),
        'application/json;charset=utf-8',
      );
      setStatus(`${records.length}개 기록의 JSON 백업을 다운로드했습니다.`);
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  };

  const exportCsv = () => {
    prepareAction();
    try {
      const now = new Date();
      downloadText(
        exportManualFlightsCsv(records),
        manualCsvFileName(now),
        'text/csv;charset=utf-8',
      );
      setStatus(`${records.length}개 기록의 CSV를 다운로드했습니다.`);
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  };

  const readBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    prepareAction();
    setBackupPreview(null);
    setBackupFileName('');
    if (file.size > MAX_LOCAL_FILE_BYTES) {
      setActionError('파일이 너무 큽니다. 50MB 이하의 JSON 백업을 선택해 주세요.');
      return;
    }
    try {
      const backup = parseManualFlightBackup(await file.text());
      setBackupPreview(backup);
      setBackupFileName(file.name);
      setRestoreMode('merge');
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  };

  const restoreBackup = async () => {
    if (!backupPreview || operation) return;
    const incomingCount = backupPreview.flights.length;
    setOperation('restore');
    setActionError('');
    setStatus('');
    try {
      const result = await onRestoreBackup(backupPreview, restoreMode);
      setStatus(restoreStatus(result, restoreMode, incomingCount));
      setBackupPreview(null);
      setBackupFileName('');
      setConfirmation(null);
      window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0);
    } finally {
      setOperation(null);
    }
  };

  const requestRestore = () => {
    if (restoreMode === 'replace') {
      setConfirmation('replace');
      return;
    }
    void restoreBackup().catch((caught) => setActionError(errorMessage(caught)));
  };

  const parseLegacy = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    prepareAction();
    setLegacyPreview(null);
    if (file.size > MAX_LOCAL_FILE_BYTES) {
      setActionError('파일이 너무 큽니다. 50MB 이하의 CSV, XLS 또는 XLSX 파일을 선택해 주세요.');
      return;
    }

    setLegacyParsing(true);
    try {
      // SheetJS and the legacy parser remain out of the initial archive bundle.
      const { parseFlightFile } = await import('../../lib/fileParser');
      const result = await parseFlightFile(file);
      if (result.err) throw new Error(result.err);
      setLegacyPreview({ sourceFileName: file.name, flights: result.flights });
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setLegacyParsing(false);
    }
  };

  const importLegacy = async () => {
    if (!legacyPreview || operation) return;
    const incomingCount = legacyPreview.flights.length;
    setOperation('legacy');
    setActionError('');
    setStatus('');
    try {
      const result = await onImportLegacy(legacyPreview);
      setStatus(legacyStatus(result, incomingCount));
      setLegacyPreview(null);
      setConfirmation(null);
      window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 0);
    } finally {
      setOperation(null);
    }
  };

  const clearAll = async () => {
    if (operation) return;
    setOperation('clear');
    setActionError('');
    setStatus('');
    try {
      await onClearAll();
      setStatus('현재 세션의 모든 비행 기록을 삭제했습니다.');
      setConfirmation(null);
      setBackupPreview(null);
      setLegacyPreview(null);
      onRequestClose();
    } finally {
      setOperation(null);
    }
  };

  return (
    <>
      <DialogShell
        open
        title="데이터 관리"
        eyebrow="CURRENT SESSION"
        description={`현재 페이지 세션에 ${records.length}개의 비행 기록이 있습니다.`}
        initialFocusRef={closeRef}
        dismissible={!busy}
        onRequestClose={onRequestClose}
        className="manual-dialog--data"
        footer={(
          <button
            ref={closeRef}
            type="button"
            className="manual-button manual-button--primary"
            onClick={onRequestClose}
            disabled={busy}
          >
            닫기
          </button>
        )}
      >
        {(status || actionError) && (
          <div
            className={`manual-alert ${actionError ? 'manual-alert--error' : 'manual-alert--success'}`}
            role={actionError ? 'alert' : 'status'}
          >
            {actionError || status}
          </div>
        )}

        <div className="manual-privacy-note">
          <strong>기록은 어디에 저장되나요?</strong>
          <p>{MANUAL_SESSION_DATA_COPY.privacy}</p>
        </div>

        <div className="manual-data-sections">
          <DataSection
            eyebrow="BACKUP"
            title="내 기록 내보내기"
            description="새로고침 전에 기록을 남겨두세요. JSON은 전체 스냅샷 복원용이고, CSV는 Flight Log와 스프레드시트에서 활용할 수 있습니다."
          >
            <button type="button" className="manual-button manual-button--primary" onClick={exportJson} disabled={busy}>
              JSON 백업 다운로드
            </button>
            <button type="button" className="manual-button manual-button--quiet" onClick={exportCsv} disabled={busy}>
              CSV 내보내기
            </button>
          </DataSection>

          <DataSection
            eyebrow="RESTORE"
            title="JSON 백업 복원"
            description={MANUAL_SESSION_DATA_COPY.restore}
          >
            <label className="manual-file-picker" htmlFor={jsonInputId} aria-disabled={busy}>
              JSON 파일 선택
            </label>
            <input
              id={jsonInputId}
              className="manual-visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void readBackup(event)}
              disabled={busy}
            />

            {backupPreview && (
              <div className="manual-import-preview" aria-live="polite">
                <div className="manual-import-preview__title">
                  <strong>{backupFileName}</strong>
                  <span>검사 완료</span>
                </div>
                <dl className="manual-preview-stats">
                  <div><dt>백업 기록</dt><dd>{backupPreview.flights.length}개</dd></div>
                  <div><dt>기간</dt><dd>{backupDateRange(backupPreview)}</dd></div>
                  <div><dt>백업 생성</dt><dd>{displayInstant(backupPreview.exportedAt)}</dd></div>
                  <div><dt>같은 ID</dt><dd>{overlapCount}개</dd></div>
                </dl>

                <fieldset className="manual-restore-mode">
                  <legend>복원 방법</legend>
                  <label>
                    <input
                      type="radio"
                      name={`${jsonInputId}-mode`}
                      checked={restoreMode === 'merge'}
                      onChange={() => setRestoreMode('merge')}
                      disabled={busy}
                    />
                    <span>
                      <strong>현재 기록과 병합</strong>
                      같은 ID는 백업의 수정 시각이 더 최신일 때만 갱신합니다.
                    </span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`${jsonInputId}-mode`}
                      checked={restoreMode === 'replace'}
                      onChange={() => setRestoreMode('replace')}
                      disabled={busy}
                    />
                    <span>
                      <strong>현재 기록 대체</strong>
                      기존 {records.length}개를 모두 지우고 백업 내용으로 바꿉니다.
                    </span>
                  </label>
                </fieldset>

                <button
                  type="button"
                  className={`manual-button ${restoreMode === 'replace' ? 'manual-button--danger' : 'manual-button--primary'}`}
                  onClick={requestRestore}
                  disabled={busy}
                >
                  {operation === 'restore' ? '복원 중…' : restoreMode === 'replace' ? '이 백업으로 대체' : '백업 병합'}
                </button>
              </div>
            )}
          </DataSection>

          <DataSection
            eyebrow="MIGRATION"
            title="기존 CSV / Excel 가져오기"
            description={MANUAL_SESSION_DATA_COPY.legacyImport}
          >
            <label className="manual-file-picker" htmlFor={legacyInputId} aria-disabled={busy}>
              {legacyParsing ? '파일 읽는 중…' : 'CSV · XLS · XLSX 파일 선택'}
            </label>
            <input
              id={legacyInputId}
              className="manual-visually-hidden"
              type="file"
              accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => void parseLegacy(event)}
              disabled={busy}
            />

            {legacyPreview && (
              <div className="manual-import-preview" aria-live="polite">
                <div className="manual-import-preview__title">
                  <strong>{legacyPreview.sourceFileName}</strong>
                  <span>{legacyPreview.flights.length}개 행 확인</span>
                </div>
                <p className="manual-field-note">
                  각 행은 새 ID로 추가합니다. 날짜와 노선이 같아도 자동으로 중복 처리하지 않습니다.
                </p>
                <ul className="manual-legacy-sample" aria-label="가져오기 미리보기">
                  {legacyPreview.flights.slice(0, 5).map((flight, index) => (
                    <li key={`${flight.fa}-${flight.ta}-${flight.d}-${index}`}>
                      <span>{flight.d || '날짜 없음'}</span>
                      <strong>{flight.fa} → {flight.ta}</strong>
                      <span>{[flight.al, flight.fn].filter(Boolean).join(' · ') || '추가 정보 없음'}</span>
                    </li>
                  ))}
                </ul>
                {legacyPreview.flights.length > 5 && (
                  <p className="manual-field-help">외 {legacyPreview.flights.length - 5}개 기록</p>
                )}
                <button
                  type="button"
                  className="manual-button manual-button--primary"
                  onClick={() => setConfirmation('legacy')}
                  disabled={busy || legacyPreview.flights.length === 0}
                >
                  이 기록 가져오기
                </button>
              </div>
            )}
          </DataSection>

          <DataSection
            eyebrow="DANGER ZONE"
            title="모든 비행 기록 삭제"
            description="현재 세션의 수동 비행 기록을 모두 지웁니다. 필요한 기록은 먼저 JSON으로 백업하세요."
            tone="danger"
          >
            <button
              type="button"
              className="manual-button manual-button--danger-outline"
              onClick={() => setConfirmation('clear')}
              disabled={busy || records.length === 0}
            >
              모든 비행 기록 삭제
            </button>
          </DataSection>
        </div>
      </DialogShell>

      <ConfirmDialog
        open={confirmation === 'replace'}
        title="현재 보관함을 백업으로 대체할까요?"
        description={`현재 ${records.length}개 기록이 삭제되고 백업의 ${backupPreview?.flights.length ?? 0}개 기록으로 바뀝니다.`}
        confirmLabel="현재 기록 대체"
        requiredText="대체"
        tone="danger"
        onCancel={() => setConfirmation(null)}
        onConfirm={restoreBackup}
      />

      <ConfirmDialog
        open={confirmation === 'legacy'}
        title={`${legacyPreview?.flights.length ?? 0}개 기존 기록을 가져올까요?`}
        description="각 행을 별도의 새 기록으로 추가합니다. 현재 저장된 기록은 지우지 않습니다."
        confirmLabel="기록 가져오기"
        onCancel={() => setConfirmation(null)}
        onConfirm={importLegacy}
      />

      <ConfirmDialog
        open={confirmation === 'clear'}
        title={MANUAL_CLEAR_ALL_CONFIRMATION.title}
        description={MANUAL_CLEAR_ALL_CONFIRMATION.description}
        confirmLabel={MANUAL_CLEAR_ALL_CONFIRMATION.confirmLabel}
        requiredText={MANUAL_CLEAR_ALL_CONFIRMATION.requiredText}
        tone="danger"
        onCancel={() => setConfirmation(null)}
        onConfirm={clearAll}
      />
    </>
  );
}
