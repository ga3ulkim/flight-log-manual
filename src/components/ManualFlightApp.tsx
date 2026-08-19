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
  manualFlightsToFlights,
  type ManualFlightInput,
  type ManualFlightRecord,
} from '../lib/manualFlight';
import { legacyFlightsToManualRecords } from '../lib/manualImport';
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
  createSessionManualFlightRepository,
  type ManualFlightRepository,
} from '../storage/sessionManualFlightRepository';
import {
  DataManagementDialog,
  FlightEditorDialog,
  type LegacyFlightImportRequest,
  type ManualFlightSubmitContext,
} from './manual';
import FlightLogChart from './FlightLogChart';
import ManualEntryView from './ManualEntryView';

type EditorState = ManualFlightRecord | null | undefined;

function readableError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : '현재 세션의 비행 기록을 변경하지 못했습니다.';
}

function focusAfterRender(id: string): void {
  window.setTimeout(() => document.getElementById(id)?.focus({ preventScroll: true }), 0);
}

export default function ManualFlightApp() {
  const repositoryRef = useRef<ManualFlightRepository | null>(null);
  if (!repositoryRef.current) {
    repositoryRef.current = createSessionManualFlightRepository();
  }
  const repository = repositoryRef.current;

  const [records, setRecords] = useState<ManualFlightRecord[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [editor, setEditor] = useState<EditorState>(undefined);
  const [editorSubmitting, setEditorSubmitting] = useState(false);
  const [dataManagementOpen, setDataManagementOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [screen, setScreen] = useState<ManualAppScreen>(() => initialManualAppScreen());

  const applyRecords = useCallback((nextRecords: ManualFlightRecord[]) => {
    setRuntimeAirportCoordinates(manualCoordinateOverrides(nextRecords));
    setRecords(nextRecords);
  }, []);

  const reloadSessionArchive = useCallback(async () => {
    const nextRecords = await repository.list();
    applyRecords(nextRecords);
    return nextRecords;
  }, [applyRecords, repository]);

  useEffect(() => {
    // A new component/page instance owns a new empty in-memory repository.
    // Legacy IndexedDB data is intentionally neither read nor deleted.
    setRuntimeAirportCoordinates({});
    return () => {
      repository.close();
      setRuntimeAirportCoordinates({});
    };
  }, [repository]);

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
    setNotice('합성 샘플은 임시 화면이며 현재 세션 기록에 추가되지 않습니다.');
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
      if (context.mode === 'edit' && context.recordId) {
        await repository.update(context.recordId, input);
      } else {
        await repository.add(input);
      }
      const committedRecords = await reloadSessionArchive();
      setScreen((current) => manualAppScreenAfterMutation(current, committedRecords.length));
      setDemoMode(false);
      setEditor(undefined);
      setNotice(
        context.mode === 'edit'
          ? '현재 세션의 비행 기록을 수정했습니다.'
          : '현재 세션에 비행 기록을 추가했습니다.',
      );
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
      await commitImmediateManualFlightDeletion(
        (id) => repository.delete(id),
        records,
        manualId,
      );
      const committedRecords = await reloadSessionArchive();
      setScreen((current) => manualAppScreenAfterMutation(current, committedRecords.length));
      setNotice('현재 세션의 비행 기록을 삭제했습니다.');

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
    const committedRecords = await reloadSessionArchive();
    setScreen((current) => manualAppScreenAfterMutation(current, committedRecords.length));
    setDemoMode(false);
    setNotice(
      mode === 'replace'
        ? 'JSON 백업을 현재 세션 기록으로 불러왔습니다.'
        : 'JSON 백업을 현재 세션 기록에 병합했습니다.',
    );
    return result;
  };

  const importLegacy = async ({ flights }: LegacyFlightImportRequest) => {
    const catalog = await loadAirportSearchCatalog();
    const importStartedAt = Date.now();
    const converted = legacyFlightsToManualRecords(flights, catalog, (index) => ({
      // Preserve the source row order for same-day timeline/playback tie breaks.
      now: () => new Date(importStartedAt + index),
    }));
    const result = await repository.merge(converted.records);
    const committedRecords = await reloadSessionArchive();
    setScreen((current) => manualAppScreenAfterMutation(current, committedRecords.length));
    setDemoMode(false);
    setNotice(`${result.added.toLocaleString()}개의 기존 기록을 현재 세션으로 가져왔습니다.`);
    return {
      added: result.added,
      skipped: converted.skipped,
      total: result.total,
    };
  };

  const clearAll = async () => {
    await repository.clear();
    await reloadSessionArchive();
    setScreen('entry');
    setDemoMode(false);
    setNotice('현재 세션의 모든 비행 기록을 삭제했습니다.');
  };

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
          sourceLabel={demoMode ? 'TEMPORARY DEMO · 합성 샘플' : 'CURRENT SESSION · 새로고침 시 초기화'}
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
