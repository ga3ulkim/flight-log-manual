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
import {
  canEnterManualArchive,
  commitImmediateManualFlightDeletion,
  initialManualAppScreen,
  manualAppScreenAfterArchiveRequest,
  manualAppScreenAfterManagementRequest,
  manualEntryEditControlId,
  manualEntryFlights,
  manualAppScreenAfterMutation,
  type ManualAppScreen,
} from '../lib/manualEntryFlow';
import { setRuntimeAirportCoordinates } from '../lib/geography';
import {
  createIndexedDbManualFlightRepository,
  mergeManualFlightRecords,
  sortManualFlightRecords,
  type ManualFlightRepositoryService,
} from '../storage/manualFlightRepository';
import {
  DataManagementDialog,
  FlightEditorDialog,
  type LegacyFlightImportRequest,
  type ManualFlightSubmitContext,
} from './manual';
import FlightLogChart from './FlightLogChart';
import ManualEntryView from './ManualEntryView';

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

function focusAfterRender(id: string): void {
  window.setTimeout(() => document.getElementById(id)?.focus({ preventScroll: true }), 0);
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
  const [notice, setNotice] = useState('');
  const [screen, setScreen] = useState<ManualAppScreen>('entry');
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
      setScreen(initialManualAppScreen());
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

  useEffect(() => {
    if (!demoMode && records.length === 0) setScreen('entry');
  }, [demoMode, records.length]);

  const visibleFlights = useMemo(
    () => demoMode ? SYNTHETIC_FLIGHTS : manualFlightsToFlights(records),
    [demoMode, records],
  );

  const enterDemo = () => {
    setRuntimeAirportCoordinates({});
    setScreen('archive');
    setDemoMode(true);
    setNotice('합성 샘플은 임시 화면이며 개인 기록에 저장되지 않습니다.');
  };

  const exitDemo = () => {
    setRuntimeAirportCoordinates(manualCoordinateOverrides(records));
    setScreen(initialManualAppScreen());
    setDemoMode(false);
    setNotice('');
  };

  const openRecordManagement = () => {
    setRuntimeAirportCoordinates(manualCoordinateOverrides(records));
    setDemoMode(false);
    setScreen(manualAppScreenAfterManagementRequest());
    setNotice('');
    focusAfterRender('manual-entry-title');
  };

  const openArchive = () => {
    if (!canEnterManualArchive(records.length)) return;
    setScreen(manualAppScreenAfterArchiveRequest(records.length));
    focusAfterRender('flight-log-title');
  };

  const openEdit = (manualId: string) => {
    const record = records.find((item) => item.id === manualId);
    if (record) setEditor(record);
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
      setScreen((current) => manualAppScreenAfterMutation(current, committedRecords.length));
      setDemoMode(false);
      setEditor(undefined);
      if (verified) {
        setNotice(context.mode === 'edit' ? '비행 기록을 수정했습니다.' : '비행 기록을 저장했습니다.');
      }
    } finally {
      setEditorSubmitting(false);
    }
  };

  const deleteFlight = async (manualId: string) => {
    const orderedIds = manualEntryFlights(records)
      .map((flight) => flight.manualId)
      .filter((id): id is string => Boolean(id));
    const deletedIndex = orderedIds.indexOf(manualId);
    const nearbyId = orderedIds[deletedIndex + 1] ?? orderedIds[deletedIndex - 1];
    const deletionOrigin = screen;

    try {
      const committedRecords = await commitImmediateManualFlightDeletion(
        (id) => repository.delete(id),
        records,
        manualId,
      );
      const verified = await reconcileAfterWrite(committedRecords);
      setScreen((current) => manualAppScreenAfterMutation(current, committedRecords.length));
      if (verified) setNotice('비행 기록을 삭제했습니다.');

      if (deletionOrigin === 'entry') {
        focusAfterRender(
          nearbyId && committedRecords.some((record) => record.id === nearbyId)
            ? manualEntryEditControlId(nearbyId)
            : 'manual-entry-add',
        );
      } else {
        focusAfterRender(committedRecords.length > 0 ? 'flight-log-title' : 'manual-entry-add');
      }
    } catch (error) {
      setNotice(`비행 기록을 삭제하지 못했습니다. ${readableError(error)}`);
    }
  };

  const requestDelete = (manualId: string) => {
    void deleteFlight(manualId);
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
    setScreen((current) => manualAppScreenAfterMutation(current, committedRecords.length));
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
    const committedRecords = mergeManualFlightRecords(records, incoming);
    const verified = await reconcileAfterWrite(committedRecords);
    setScreen((current) => manualAppScreenAfterMutation(current, committedRecords.length));
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
    setScreen('entry');
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

  const showEntry = !demoMode && (screen === 'entry' || records.length === 0);
  return (
    <>
      {showEntry ? (
        <ManualEntryView
          records={records}
          onAddFlight={() => setEditor(null)}
          onEditFlight={openEdit}
          onDeleteFlight={requestDelete}
          onOpenArchive={openArchive}
          onOpenDataManagement={() => setDataManagementOpen(true)}
          onOpenDemo={enterDemo}
        />
      ) : (
        <FlightLogChart
          flights={visibleFlights}
          sourceLabel={demoMode ? 'TEMPORARY DEMO · 합성 샘플' : 'LOCAL ARCHIVE · 이 브라우저'}
          demoMode={demoMode}
          onAddFlight={() => setEditor(null)}
          onOpenRecordManagement={openRecordManagement}
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

    </>
  );
}
