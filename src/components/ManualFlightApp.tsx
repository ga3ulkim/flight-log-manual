import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SYNTHETIC_FLIGHTS } from '../data/syntheticFlights';
import { loadAirportSearchCatalog } from '../lib/airportSearch';
import {
  restoreManualFlightBackup,
  type ManualBackupRestoreMode,
  type ManualFlightBackup,
} from '../lib/manualBackup';
import { manualCoordinateOverrides } from '../lib/manualCoordinates';
import {
  createManualFlight,
  manualFlightsToFlights,
  type ManualFlightInput,
  type ManualFlightRecord,
} from '../lib/manualFlight';
import { legacyFlightsToManualInputs } from '../lib/manualImport';
import { setRuntimeAirportCoordinates } from '../lib/geography';
import {
  createIndexedDbManualFlightRepository,
  mergeManualFlightRecords,
  sortManualFlightRecords,
  type ManualFlightRepositoryService,
} from '../storage/manualFlightRepository';
import {
  ConfirmDialog,
  DataManagementDialog,
  FlightEditorDialog,
  type LegacyFlightImportRequest,
  type ManualFlightSubmitContext,
} from './manual';
import FlightLogChart from './FlightLogChart';

type StorageStatus = 'loading' | 'ready' | 'error';
type EditorState = ManualFlightRecord | null | undefined;

function sameManualRecords(
  left: readonly ManualFlightRecord[],
  right: readonly ManualFlightRecord[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((record, index) => JSON.stringify(record) === JSON.stringify(right[index]));
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : '브라우저 저장소를 사용할 수 없습니다.';
}

function storagePersistenceRequest(): void {
  const persist = navigator.storage?.persist;
  if (typeof persist !== 'function') return;
  void persist.call(navigator.storage).catch(() => undefined);
}

export default function ManualFlightApp() {
  const repositoryRef = useRef<ManualFlightRepositoryService | null>(null);
  if (!repositoryRef.current) {
    repositoryRef.current = createIndexedDbManualFlightRepository();
  }
  const repository = repositoryRef.current;

  const [storageStatus, setStorageStatus] = useState<StorageStatus>('loading');
  const [storageError, setStorageError] = useState('');
  const [records, setRecords] = useState<ManualFlightRecord[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [editor, setEditor] = useState<EditorState>(undefined);
  const [editorSubmitting, setEditorSubmitting] = useState(false);
  const [dataManagementOpen, setDataManagementOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManualFlightRecord | null>(null);
  const [notice, setNotice] = useState('');
  const recordsRef = useRef<ManualFlightRecord[]>([]);

  const applyRecords = useCallback((nextRecords: ManualFlightRecord[]) => {
    recordsRef.current = nextRecords;
    setRuntimeAirportCoordinates(manualCoordinateOverrides(nextRecords));
    setRecords(nextRecords);
  }, []);

  const reloadArchive = useCallback(async () => {
    const nextRecords = await repository.list();
    if (!sameManualRecords(recordsRef.current, nextRecords)) applyRecords(nextRecords);
    return nextRecords;
  }, [applyRecords, repository]);

  const reconcileAfterWrite = useCallback(async (
    committedRecords: readonly ManualFlightRecord[],
  ): Promise<boolean> => {
    try {
      await reloadArchive();
      return true;
    } catch {
      applyRecords(sortManualFlightRecords(committedRecords));
      setNotice(
        '저장은 완료됐지만 저장소 재확인에 실패해 방금 변경한 내용을 표시합니다. 페이지를 다시 열어 확인해 주세요.',
      );
      return false;
    }
  }, [applyRecords, reloadArchive]);

  const initializeStorage = useCallback(async () => {
    setStorageStatus('loading');
    setStorageError('');
    try {
      await reloadArchive();
      setStorageStatus('ready');
    } catch (error) {
      setRuntimeAirportCoordinates({});
      setStorageError(readableError(error));
      setStorageStatus('error');
    }
  }, [reloadArchive]);

  useEffect(() => {
    void initializeStorage();
    return () => {
      repository.close();
      setRuntimeAirportCoordinates({});
    };
  }, [initializeStorage, repository]);

  useEffect(() => {
    if (storageStatus !== 'ready' || demoMode) return undefined;
    const refreshVisibleArchive = () => {
      if (document.visibilityState === 'visible') {
        void reloadArchive().catch(() => undefined);
      }
    };
    window.addEventListener('focus', refreshVisibleArchive);
    document.addEventListener('visibilitychange', refreshVisibleArchive);
    return () => {
      window.removeEventListener('focus', refreshVisibleArchive);
      document.removeEventListener('visibilitychange', refreshVisibleArchive);
    };
  }, [demoMode, reloadArchive, storageStatus]);

  const visibleFlights = useMemo(
    () => demoMode ? SYNTHETIC_FLIGHTS : manualFlightsToFlights(records),
    [demoMode, records],
  );

  const enterDemo = () => {
    setRuntimeAirportCoordinates({});
    setDemoMode(true);
    setNotice('합성 샘플은 임시 화면이며 개인 기록에 저장되지 않습니다.');
  };

  const exitDemo = () => {
    setRuntimeAirportCoordinates(manualCoordinateOverrides(records));
    setDemoMode(false);
    setNotice('');
  };

  const openEdit = (manualId: string) => {
    const record = records.find((item) => item.id === manualId);
    if (record) setEditor(record);
  };

  const requestDelete = (manualId: string) => {
    const record = records.find((item) => item.id === manualId);
    if (record) setDeleteTarget(record);
  };

  const saveFlight = async (
    input: ManualFlightInput,
    context: ManualFlightSubmitContext,
  ) => {
    setEditorSubmitting(true);
    try {
      let committedRecords: ManualFlightRecord[];
      if (context.mode === 'edit' && context.recordId) {
        const updated = await repository.update(context.recordId, input);
        committedRecords = sortManualFlightRecords(
          records.map((record) => record.id === updated.id ? updated : record),
        );
      } else {
        const firstRecord = records.length === 0;
        const created = await repository.add(input);
        committedRecords = sortManualFlightRecords([...records, created]);
        if (firstRecord) storagePersistenceRequest();
      }
      const verified = await reconcileAfterWrite(committedRecords);
      setDemoMode(false);
      setEditor(undefined);
      if (verified) {
        setNotice(context.mode === 'edit' ? '비행 기록을 수정했습니다.' : '비행 기록을 저장했습니다.');
      }
    } finally {
      setEditorSubmitting(false);
    }
  };

  const deleteFlight = async () => {
    if (!deleteTarget) return;
    await repository.delete(deleteTarget.id);
    const verified = await reconcileAfterWrite(
      records.filter((record) => record.id !== deleteTarget.id),
    );
    setDeleteTarget(null);
    if (verified) setNotice('비행 기록을 삭제했습니다.');
  };

  const restoreBackup = async (
    backup: ManualFlightBackup,
    mode: ManualBackupRestoreMode,
  ) => {
    const result = await restoreManualFlightBackup(repository, backup, mode);
    const committedRecords = mode === 'replace'
      ? sortManualFlightRecords(backup.flights)
      : mergeManualFlightRecords(records, backup.flights);
    const verified = await reconcileAfterWrite(committedRecords);
    setDemoMode(false);
    if (verified) {
      setNotice(mode === 'replace' ? 'JSON 백업으로 기록을 교체했습니다.' : 'JSON 백업을 병합했습니다.');
    }
    return result;
  };

  const importLegacy = async ({ flights }: LegacyFlightImportRequest) => {
    const catalog = await loadAirportSearchCatalog();
    const converted = legacyFlightsToManualInputs(flights, catalog);
    const importStartedAt = Date.now();
    const incoming = converted.inputs.map((input, index) => createManualFlight(input, {
      // Preserve the source row order for same-day timeline/playback tie breaks.
      now: () => new Date(importStartedAt + index),
    }));
    const result = await repository.merge(incoming);
    const verified = await reconcileAfterWrite(mergeManualFlightRecords(records, incoming));
    setDemoMode(false);
    if (verified) {
      setNotice(`${result.added.toLocaleString()}개의 기존 기록을 가져왔습니다.`);
    }
    return {
      added: result.added,
      skipped: converted.skipped,
      total: result.total,
    };
  };

  const clearAll = async () => {
    await repository.clear();
    applyRecords([]);
    setDemoMode(false);
    setNotice('이 브라우저의 모든 비행 기록을 삭제했습니다.');
  };

  if (storageStatus === 'loading') {
    return (
      <main className="flc-app flc-storage-state" aria-busy="true">
        <div className="flc-storage-card" role="status">
          <div className="flc-eyebrow">PERSONAL FLIGHT LOG</div>
          <h1>비행 기록을 불러오는 중입니다</h1>
          <p>이 브라우저에 저장된 개인 아카이브를 확인하고 있습니다.</p>
        </div>
      </main>
    );
  }

  if (storageStatus === 'error') {
    return (
      <main className="flc-app flc-storage-state">
        <div className="flc-storage-card">
          <div className="flc-eyebrow">STORAGE UNAVAILABLE</div>
          <h1>비행 기록 저장소를 열지 못했습니다</h1>
          <p role="alert">{storageError}</p>
          <button className="flc-btn flc-btn-primary" type="button" onClick={() => void initializeStorage()}>
            다시 시도
          </button>
        </div>
      </main>
    );
  }

  const showFirstRun = records.length === 0 && !demoMode;
  return (
    <>
      {showFirstRun ? (
        <main className="flc-app flc-landing">
          <div className="flc-landing-shell">
            <section className="flc-landing-copy" aria-labelledby="landing-title">
              <div className="flc-eyebrow">PERSONAL FLIGHT LOG</div>
              <h1 className="flc-landing-title" id="landing-title">
                <span className="flc-landing-title-line">나의 비행</span>{' '}
                <span className="flc-landing-title-line">아카이브</span>
              </h1>
              <p className="flc-landing-statement">
                한 편씩 기록하고,
                <br />
                지도와 시간 속에서 다시 봅니다.
              </p>
              <p className="flc-landing-english">Your journeys, saved in this browser.</p>
              <div className="flc-privacy-seal">
                <span className="flc-privacy-seal-mark" aria-hidden="true">LOCAL<br />LOG</span>
                <span>
                  <strong>PRIVATE BY DESIGN</strong>
                  비행 기록은 이 브라우저에 저장되며 서버나 계정으로 전송되지 않습니다.
                </span>
              </div>
            </section>

            <section className="flc-first-run-panel" aria-labelledby="first-run-heading">
              <div className="flc-eyebrow">YOUR ARCHIVE STARTS HERE</div>
              <h2 id="first-run-heading">아직 기록된 비행이 없습니다</h2>
              <p>첫 비행부터 직접 기록해 보세요. 공항을 선택하면 도시와 국가, 좌표는 자동으로 채워집니다.</p>
              <div className="flc-first-run-actions">
                <button className="flc-btn flc-btn-primary" type="button" onClick={() => setEditor(null)}>
                  + 첫 비행 기록 추가
                </button>
                <button className="flc-btn" type="button" onClick={enterDemo}>
                  합성 샘플로 둘러보기
                </button>
                <button className="flc-btn" type="button" onClick={() => setDataManagementOpen(true)}>
                  데이터 관리
                </button>
              </div>
              <p className="flc-first-run-note">
                IndexedDB는 브라우저·기기별 저장소입니다. 사이트 데이터를 지우면 기록도 사라질 수 있으므로 데이터 관리에서 JSON 백업을 정기적으로 보관하세요.
              </p>
            </section>
          </div>
        </main>
      ) : (
        <FlightLogChart
          flights={visibleFlights}
          sourceLabel={demoMode ? 'TEMPORARY DEMO · 합성 샘플' : 'LOCAL ARCHIVE · 이 브라우저'}
          demoMode={demoMode}
          onAddFlight={() => setEditor(null)}
          onOpenDataManagement={() => setDataManagementOpen(true)}
          onEditFlight={openEdit}
          onDeleteFlight={requestDelete}
          onExitDemo={exitDemo}
        />
      )}

      {notice && (
        <div className="flc-notice" role="status">
          <span>{notice}</span>
          <button type="button" aria-label="알림 닫기" onClick={() => setNotice('')}>×</button>
        </div>
      )}

      <FlightEditorDialog
        open={editor !== undefined}
        initialFlight={editor ?? null}
        history={records}
        submitting={editorSubmitting}
        onSubmit={saveFlight}
        onRequestClose={() => setEditor(undefined)}
      />

      <DataManagementDialog
        open={dataManagementOpen}
        records={records}
        onRequestClose={() => setDataManagementOpen(false)}
        onRestoreBackup={restoreBackup}
        onImportLegacy={importLegacy}
        onClearAll={clearAll}
      />

      <ConfirmDialog
        open={deleteTarget != null}
        title="이 비행 기록을 삭제할까요?"
        description={deleteTarget
          ? `${deleteTarget.date.replace(/-/g, '.')} · ${deleteTarget.departure.iata} → ${deleteTarget.arrival.iata}`
          : ''}
        confirmLabel="비행 기록 삭제"
        tone="danger"
        onConfirm={deleteFlight}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
