import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { resolveAirportCoordinate } from '../../data/airports';
import {
  type AirportSearchCatalog,
  type AirportSearchEntry,
  loadAirportSearchCatalog,
} from '../../lib/airportSearch';
import {
  type AirlineSearchCatalog,
  loadAirlineSearchCatalog,
} from '../../lib/airlineSearch';
import {
  ManualFlightValidationError,
  createManualAirportSnapshot,
  createManualFlight,
  inferManualFlightType,
  type ManualAirportSnapshot,
  type ManualFlightInput,
  type ManualFlightRecord,
} from '../../lib/manualFlight';
import type { FlightType } from '../../types';
import AirlineCombobox, { type AirlineSelection } from './AirlineCombobox';
import { ConfirmDialog } from './ConfirmDialog';
import { DialogShell } from './DialogShell';

type MaybePromise<T> = T | Promise<T>;
type AirportRole = 'departure' | 'arrival';
type FieldErrors = Record<string, string>;

interface ManualAirportFields {
  iata: string;
  name: string;
  municipality: string;
  countryCode: string;
  countryName: string;
  latitude: string;
  longitude: string;
}

interface AirportDraft {
  mode: 'search' | 'manual';
  query: string;
  selected: ManualAirportSnapshot | null;
  manual: ManualAirportFields;
}

interface FlightFormState {
  date: string;
  departureTime: string;
  departure: AirportDraft;
  arrival: AirportDraft;
  airline: string;
  airlineSelection: AirlineSelection | null;
  flightNumber: string;
  aircraft: string;
  explicitType: FlightType | null;
}

export interface ManualFlightSubmitContext {
  mode: 'add' | 'edit';
  recordId?: string;
}

export interface FlightEditorDialogProps {
  open: boolean;
  /** Supplying a record switches the surface to edit mode. */
  initialFlight?: ManualFlightRecord | null;
  /** Used only for local datalist suggestions; free text always remains valid. */
  history?: readonly ManualFlightRecord[];
  submitting?: boolean;
  onSubmit: (
    input: ManualFlightInput,
    context: ManualFlightSubmitContext,
  ) => MaybePromise<void>;
  onRequestClose: () => void;
}

function localDateOnly(date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyManualAirport(): ManualAirportFields {
  return {
    iata: '',
    name: '',
    municipality: '',
    countryCode: '',
    countryName: '',
    latitude: '',
    longitude: '',
  };
}

function manualFieldsFromSnapshot(snapshot: ManualAirportSnapshot): ManualAirportFields {
  return {
    iata: snapshot.iata,
    name: snapshot.name,
    municipality: snapshot.municipality,
    countryCode: snapshot.countryCode,
    countryName: snapshot.countryName,
    latitude: snapshot.latitude == null ? '' : String(snapshot.latitude),
    longitude: snapshot.longitude == null ? '' : String(snapshot.longitude),
  };
}

function airportDraft(snapshot?: ManualAirportSnapshot): AirportDraft {
  return snapshot
    ? {
        mode: 'search',
        query: snapshot.iata,
        selected: snapshot,
        manual: manualFieldsFromSnapshot(snapshot),
      }
    : {
        mode: 'search',
        query: '',
        selected: null,
        manual: emptyManualAirport(),
      };
}

function initialForm(record?: ManualFlightRecord | null): FlightFormState {
  return {
    date: record?.date ?? localDateOnly(),
    departureTime: record?.departureTime ?? '',
    departure: airportDraft(record?.departure),
    arrival: airportDraft(record?.arrival),
    airline: record?.airline ?? '',
    airlineSelection: record?.airlineSnapshot ?? null,
    flightNumber: record?.flightNumber ?? '',
    aircraft: record?.aircraft ?? '',
    explicitType: record?.type ?? null,
  };
}

function countryCodeOf(
  draft: AirportDraft,
  catalog: AirportSearchCatalog | null,
): string {
  if (draft.mode === 'manual') return draft.manual.countryCode.trim().toUpperCase();
  return draft.selected?.countryCode
    ?? catalog?.findByIata(draft.query)?.countryCode
    ?? '';
}

function airportIsReady(
  draft: AirportDraft,
  catalog: AirportSearchCatalog | null,
): boolean {
  if (draft.mode === 'search') {
    return draft.selected !== null || catalog?.findByIata(draft.query) !== undefined;
  }
  return /^[A-Za-z]{3}$/.test(draft.manual.iata.trim());
}

function coordinateValue(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

function manualSnapshot(fields: ManualAirportFields): ManualAirportSnapshot {
  return {
    iata: fields.iata.trim().toUpperCase(),
    name: fields.name.trim(),
    municipality: fields.municipality.trim(),
    countryCode: fields.countryCode.trim().toUpperCase(),
    countryName: fields.countryName.trim(),
    latitude: coordinateValue(fields.latitude),
    longitude: coordinateValue(fields.longitude),
  };
}

function knownSnapshot(entry: AirportSearchEntry): ManualAirportSnapshot {
  return createManualAirportSnapshot(
    entry,
    resolveAirportCoordinate(entry.iata),
  );
}

function uniqueHistoryValues(
  history: readonly ManualFlightRecord[],
  key: 'airline' | 'flightNumber' | 'aircraft',
): string[] {
  return [...new Set(history.map((record) => record[key].trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ko'))
    .slice(0, 100);
}

function joinedDescriptionIds(...ids: Array<string | undefined>): string | undefined {
  const result = ids.filter(Boolean).join(' ');
  return result || undefined;
}

function firstError(errors: FieldErrors, ...paths: string[]): string | undefined {
  for (const path of paths) {
    if (errors[path]) return errors[path];
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : '비행 기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

interface AirportFieldProps {
  role: AirportRole;
  label: string;
  draft: AirportDraft;
  catalog: AirportSearchCatalog | null;
  catalogLoading: boolean;
  catalogError: string;
  errors: FieldErrors;
  disabled: boolean;
  onChange: (draft: AirportDraft) => void;
}

function AirportField({
  role,
  label,
  draft,
  catalog,
  catalogLoading,
  catalogError,
  errors,
  disabled,
  onChange,
}: AirportFieldProps) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-listbox`;
  const helpId = `${baseId}-help`;
  const errorId = `${baseId}-error`;
  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const results = useMemo(
    () => catalog?.search(draft.query, 8) ?? [],
    [catalog, draft.query],
  );
  const airportError = firstError(
    errors,
    role,
    `${role}.iata`,
    `${role}.countryCode`,
  );

  const chooseAirport = (entry: AirportSearchEntry) => {
    const snapshot = knownSnapshot(entry);
    onChange({
      mode: 'search',
      query: entry.iata,
      selected: snapshot,
      manual: manualFieldsFromSnapshot(snapshot),
    });
    setListOpen(false);
    setActiveIndex(-1);
  };

  const enterManualMode = () => {
    const exact = catalog?.findByIata(draft.query);
    const snapshot = draft.selected ?? (exact ? knownSnapshot(exact) : null);
    onChange({
      mode: 'manual',
      query: draft.query,
      selected: null,
      manual: snapshot
        ? manualFieldsFromSnapshot(snapshot)
        : { ...draft.manual, iata: draft.query.trim().toUpperCase().slice(0, 3) },
    });
    setListOpen(false);
  };

  const updateManual = (key: keyof ManualAirportFields, value: string) => {
    onChange({
      ...draft,
      manual: { ...draft.manual, [key]: value },
    });
  };

  if (draft.mode === 'manual') {
    const coordinateError = firstError(
      errors,
      role,
      `${role}.latitude`,
      `${role}.longitude`,
    );
    return (
      <fieldset className="manual-airport manual-airport--direct">
        <legend>{label}</legend>
        <div className="manual-airport__mode-row">
          <span className="manual-airport__mode">직접 입력</span>
          <button
            type="button"
            className="manual-link-button"
            onClick={() => onChange({
              ...draft,
              mode: 'search',
              query: draft.manual.iata,
              selected: null,
            })}
            disabled={disabled}
          >
            공항 검색으로 돌아가기
          </button>
        </div>

        <div className="manual-form-grid manual-form-grid--airport">
          <div className="manual-field manual-field--short">
            <label htmlFor={`${baseId}-iata`}>IATA <span aria-hidden="true">*</span></label>
            <input
              id={`${baseId}-iata`}
              value={draft.manual.iata}
              onChange={(event) => updateManual('iata', event.target.value.toUpperCase())}
              maxLength={3}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              required
              aria-required="true"
              aria-describedby={joinedDescriptionIds(
                helpId,
                (airportError || coordinateError) ? errorId : undefined,
              )}
              aria-invalid={Boolean(firstError(errors, `${role}.iata`, role))}
              data-error={Boolean(firstError(errors, `${role}.iata`, role)) || undefined}
            />
          </div>
          <div className="manual-field manual-field--wide">
            <label htmlFor={`${baseId}-name`}>공항 이름 <span className="manual-optional">선택</span></label>
            <input
              id={`${baseId}-name`}
              value={draft.manual.name}
              onChange={(event) => updateManual('name', event.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="manual-field">
            <label htmlFor={`${baseId}-city`}>도시 <span className="manual-optional">선택</span></label>
            <input
              id={`${baseId}-city`}
              value={draft.manual.municipality}
              onChange={(event) => updateManual('municipality', event.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="manual-field manual-field--short">
            <label htmlFor={`${baseId}-country-code`}>국가 코드 <span className="manual-optional">ISO 2자</span></label>
            <input
              id={`${baseId}-country-code`}
              value={draft.manual.countryCode}
              onChange={(event) => updateManual('countryCode', event.target.value.toUpperCase())}
              maxLength={2}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              aria-describedby={joinedDescriptionIds(
                helpId,
                (airportError || coordinateError) ? errorId : undefined,
              )}
              aria-invalid={Boolean(errors[`${role}.countryCode`])}
              data-error={Boolean(errors[`${role}.countryCode`]) || undefined}
            />
          </div>
          <div className="manual-field">
            <label htmlFor={`${baseId}-country-name`}>국가 이름 <span className="manual-optional">선택</span></label>
            <input
              id={`${baseId}-country-name`}
              value={draft.manual.countryName}
              onChange={(event) => updateManual('countryName', event.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="manual-field">
            <label htmlFor={`${baseId}-latitude`}>위도 <span className="manual-optional">선택</span></label>
            <input
              id={`${baseId}-latitude`}
              type="number"
              min="-90"
              max="90"
              step="any"
              inputMode="decimal"
              value={draft.manual.latitude}
              onChange={(event) => updateManual('latitude', event.target.value)}
              disabled={disabled}
              aria-describedby={joinedDescriptionIds(
                helpId,
                (airportError || coordinateError) ? errorId : undefined,
              )}
              aria-invalid={Boolean(coordinateError)}
              data-error={Boolean(coordinateError) || undefined}
            />
          </div>
          <div className="manual-field">
            <label htmlFor={`${baseId}-longitude`}>경도 <span className="manual-optional">선택</span></label>
            <input
              id={`${baseId}-longitude`}
              type="number"
              min="-180"
              max="180"
              step="any"
              inputMode="decimal"
              value={draft.manual.longitude}
              onChange={(event) => updateManual('longitude', event.target.value)}
              disabled={disabled}
              aria-describedby={joinedDescriptionIds(
                helpId,
                (airportError || coordinateError) ? errorId : undefined,
              )}
              aria-invalid={Boolean(coordinateError)}
              data-error={Boolean(coordinateError) || undefined}
            />
          </div>
        </div>
        <p id={helpId} className="manual-field-help">좌표는 둘 다 알 때만 입력하세요. 모르면 비워 두어도 기록은 저장됩니다.</p>
        {(airportError || coordinateError) && (
          <p id={errorId} className="manual-field-error" role="alert">{airportError ?? coordinateError}</p>
        )}
      </fieldset>
    );
  }

  const showResults = listOpen && !draft.selected && draft.query.trim() !== '';
  const activeResult = activeIndex >= 0 ? results[activeIndex] : undefined;

  const handleComboboxKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && showResults) {
      event.preventDefault();
      event.stopPropagation();
      setListOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setListOpen(true);
      setActiveIndex((current) => current < results.length - 1 ? current + 1 : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setListOpen(true);
      setActiveIndex((current) => current > 0 ? current - 1 : results.length - 1);
    } else if (event.key === 'Enter' && showResults && activeResult) {
      event.preventDefault();
      chooseAirport(activeResult);
    } else if (event.key === 'Tab') {
      setListOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div
      className="manual-airport"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
          setListOpen(false);
          setActiveIndex(-1);
        }
      }}
    >
      <label htmlFor={inputId}>{label} <span aria-hidden="true">*</span></label>
      <div className="manual-combobox-wrap">
        <input
          id={inputId}
          className="manual-combobox"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showResults}
          aria-controls={showResults ? listId : undefined}
          aria-describedby={joinedDescriptionIds(helpId, airportError ? errorId : undefined)}
          aria-invalid={Boolean(airportError)}
          data-error={Boolean(airportError) || undefined}
          value={draft.query}
          placeholder="IATA, 공항 이름 또는 도시 검색"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={disabled}
          required
          aria-required="true"
          aria-activedescendant={showResults && activeResult ? `${baseId}-option-${activeResult.iata}` : undefined}
          onFocus={() => {
            if (!draft.selected && draft.query.trim()) setListOpen(true);
          }}
          onChange={(event) => {
            onChange({ ...draft, query: event.target.value, selected: null });
            setListOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleComboboxKeyDown}
        />
        {draft.selected && (
          <button
            type="button"
            className="manual-combobox__clear"
            aria-label={`${label} 선택 변경`}
            onClick={() => onChange({ ...draft, selected: null, query: '' })}
            disabled={disabled}
          >
            변경
          </button>
        )}
      </div>

      <p id={helpId} className="manual-field-help">
        {catalogLoading
          ? '로컬 공항 목록을 준비하고 있습니다…'
          : '공항 코드를 정확히 입력하거나 검색 결과를 선택하세요.'}
      </p>
      {catalogError && (
        <p className="manual-field-note" role="status">
          {catalogError} 직접 입력은 계속 사용할 수 있습니다.
        </p>
      )}
      {airportError && <p id={errorId} className="manual-field-error" role="alert">{airportError}</p>}

      {draft.selected && (
        <div className="manual-airport-selection" aria-live="polite">
          <strong>{draft.selected.iata} · {draft.selected.name || '이름 없는 공항'}</strong>
          <span>
            {[draft.selected.municipality, draft.selected.countryName || draft.selected.countryCode]
              .filter(Boolean)
              .join(' · ') || '도시·국가 정보 없음'}
          </span>
          <button
            type="button"
            className="manual-link-button"
            onClick={enterManualMode}
            disabled={disabled}
          >
            이 공항 정보를 직접 수정
          </button>
        </div>
      )}

      {showResults && (
        <ul id={listId} className="manual-airport-results" role="listbox" aria-label={`${label} 검색 결과`}>
          {results.map((entry, index) => (
            <li
              id={`${baseId}-option-${entry.iata}`}
              key={entry.iata}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'is-active' : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseAirport(entry)}
            >
              <strong>{entry.iata} · {entry.name}</strong>
              <span>{entry.municipality} · {entry.countryName || entry.countryCode}</span>
            </li>
          ))}
          {!catalogLoading && results.length === 0 && (
            <li className="manual-airport-results__empty" role="option" aria-disabled="true">
              일치하는 공항이 없습니다.
            </li>
          )}
        </ul>
      )}

      {!draft.selected && (
        <button
          type="button"
          className="manual-link-button manual-airport__fallback"
          onClick={enterManualMode}
          disabled={disabled}
        >
          공항을 찾을 수 없나요? 직접 입력
        </button>
      )}
    </div>
  );
}

interface OptionalTextFieldProps {
  id: string;
  label: string;
  value: string;
  listId: string;
  disabled: boolean;
  children?: ReactNode;
  onChange: (value: string) => void;
}

function OptionalTextField({
  id,
  label,
  value,
  listId,
  disabled,
  children,
  onChange,
}: OptionalTextFieldProps) {
  return (
    <div className="manual-field">
      <label htmlFor={id}>{label} <span className="manual-optional">선택</span></label>
      <input
        id={id}
        value={value}
        list={listId}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      {children}
    </div>
  );
}

export function FlightEditorDialog(props: FlightEditorDialogProps) {
  if (!props.open) return null;
  return <FlightEditorDialogSession {...props} />;
}

function FlightEditorDialogSession({
  initialFlight,
  history = [],
  submitting = false,
  onSubmit,
  onRequestClose,
}: FlightEditorDialogProps) {
  const mode = initialFlight ? 'edit' : 'add';
  const [form, setForm] = useState<FlightFormState>(() => initialForm(initialFlight));
  const baseline = useRef(JSON.stringify(form));
  const [catalog, setCatalog] = useState<AirportSearchCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [airlineCatalog, setAirlineCatalog] = useState<AirlineSearchCatalog | null>(null);
  const [airlineCatalogLoading, setAirlineCatalogLoading] = useState(true);
  const [airlineCatalogError, setAirlineCatalogError] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const formId = useId();
  const dateId = useId();
  const departureTimeId = useId();
  const flightNumberId = useId();
  const aircraftId = useId();
  const flightNumberListId = useId();
  const aircraftListId = useId();
  const isSaving = submitting || saving;
  const dirty = JSON.stringify(form) !== baseline.current;

  useEffect(() => {
    let alive = true;
    void loadAirportSearchCatalog()
      .then((loaded) => {
        if (!alive) return;
        setCatalog(loaded);
        setCatalogLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setCatalogError('공항 검색 목록을 불러오지 못했습니다.');
        setCatalogLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void loadAirlineSearchCatalog()
      .then((loaded) => {
        if (!alive) return;
        setAirlineCatalog(loaded);
        setAirlineCatalogLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setAirlineCatalogError('항공사 검색 목록을 불러오지 못했습니다.');
        setAirlineCatalogLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const suggestions = useMemo(() => ({
    airline: uniqueHistoryValues(history, 'airline'),
    flightNumber: uniqueHistoryValues(history, 'flightNumber'),
    aircraft: uniqueHistoryValues(history, 'aircraft'),
  }), [history]);

  const inferredType = inferManualFlightType(
    { countryCode: countryCodeOf(form.departure, catalog) },
    { countryCode: countryCodeOf(form.arrival, catalog) },
  );
  const showExplicitType = airportIsReady(form.departure, catalog)
    && airportIsReady(form.arrival, catalog)
    && inferredType === null;

  const updateAirport = (role: AirportRole, value: AirportDraft) => {
    setForm((current) => ({ ...current, [role]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[role];
      delete next[`${role}.iata`];
      delete next[`${role}.countryCode`];
      delete next[`${role}.latitude`];
      delete next[`${role}.longitude`];
      // The equal-endpoint validation is attached to arrival.iata, while the
      // classification depends on both endpoints. Either endpoint changing
      // makes those cross-field messages stale until the next submit.
      delete next['arrival.iata'];
      delete next.type;
      if (role === 'departure') delete next.departureTime;
      return next;
    });
  };

  const airportForSubmit = (role: AirportRole): ManualAirportSnapshot | null => {
    const draft = form[role];
    if (draft.mode === 'manual') return manualSnapshot(draft.manual);
    if (draft.selected) return draft.selected;
    const exact = catalog?.findByIata(draft.query);
    return exact ? knownSnapshot(exact) : null;
  };

  const focusErrorSummary = () => {
    window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
  };

  const validatedInput = (): ManualFlightInput | null => {
    const departure = airportForSubmit('departure');
    const arrival = airportForSubmit('arrival');
    const nextErrors: FieldErrors = {};
    if (!departure) nextErrors.departure = '검색 결과에서 출발 공항을 선택하거나 직접 입력해 주세요.';
    if (!arrival) nextErrors.arrival = '검색 결과에서 도착 공항을 선택하거나 직접 입력해 주세요.';
    if (!departure || !arrival) {
      setErrors(nextErrors);
      focusErrorSummary();
      return null;
    }

    const input: ManualFlightInput = {
      date: form.date,
      departureTime: form.departureTime || undefined,
      departure,
      arrival,
      airline: form.airline,
      airlineSnapshot: form.airlineSelection ?? undefined,
      flightNumber: form.flightNumber,
      aircraft: form.aircraft,
      type: inferredType ?? form.explicitType ?? undefined,
    };

    try {
      createManualFlight(input, {
        generateId: () => 'manual-flight-form-validation',
        now: () => new Date('2000-01-01T00:00:00.000Z'),
      });
      setErrors({});
      return input;
    } catch (caught) {
      if (!(caught instanceof ManualFlightValidationError)) throw caught;
      for (const issue of caught.issues) {
        nextErrors[issue.path || 'form'] ??= issue.message;
      }
      setErrors(nextErrors);
      focusErrorSummary();
      return null;
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    setSaveError('');
    const input = validatedInput();
    if (!input) return;

    setSaving(true);
    try {
      await onSubmit(input, {
        mode,
        recordId: initialFlight?.id,
      });
      onRequestClose();
    } catch (caught) {
      setSaveError(errorMessage(caught));
      focusErrorSummary();
    } finally {
      setSaving(false);
    }
  };

  const attemptClose = () => {
    if (isSaving) return;
    if (dirty) setDiscardOpen(true);
    else onRequestClose();
  };

  const errorCount = Object.values(errors).filter(Boolean).length + (saveError ? 1 : 0);
  const dateError = errors.date;
  const departureTimeError = errors.departureTime;
  const typeError = errors.type;

  return (
    <>
      <DialogShell
        open
        title={mode === 'edit' ? '비행 기록 수정' : '새 비행 기록'}
        eyebrow="PERSONAL FLIGHT LOG"
        description="날짜와 두 공항만 필수입니다. 공항 정보는 저장 시점의 스냅샷으로 보관됩니다."
        initialFocusRef={dateRef}
        dismissible={!isSaving}
        onRequestClose={attemptClose}
        className="manual-dialog--flight"
        footer={(
          <>
            <button
              type="button"
              className="manual-button manual-button--quiet"
              onClick={attemptClose}
              disabled={isSaving}
            >
              취소
            </button>
            <button
              type="submit"
              form={formId}
              className="manual-button manual-button--primary"
              disabled={isSaving}
            >
              {isSaving ? '저장 중…' : mode === 'edit' ? '수정 내용 저장' : '비행 기록 저장'}
            </button>
          </>
        )}
      >
        <form id={formId} className="manual-flight-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
          {errorCount > 0 && (
            <div
              ref={errorSummaryRef}
              className="manual-alert manual-alert--error"
              role="alert"
              tabIndex={-1}
            >
              <strong>입력 내용을 확인해 주세요.</strong>
              <span>{saveError || Object.values(errors)[0]}</span>
            </div>
          )}

          <div className="manual-form-grid manual-form-grid--schedule">
            <div className="manual-field manual-field--date">
              <label htmlFor={dateId}>날짜 <span aria-hidden="true">*</span></label>
              <input
                ref={dateRef}
                id={dateId}
                type="date"
                min="1900-01-01"
                value={form.date}
                onChange={(event) => {
                  setForm((current) => ({ ...current, date: event.target.value }));
                  setErrors((current) => {
                    const next = { ...current };
                    delete next.date;
                    delete next.departureTime;
                    return next;
                  });
                }}
                disabled={isSaving}
                required
                aria-required="true"
                aria-invalid={Boolean(dateError)}
                aria-describedby={dateError ? `${dateId}-error` : undefined}
                data-error={Boolean(dateError) || undefined}
              />
              {dateError && <p id={`${dateId}-error`} className="manual-field-error">{dateError}</p>}
            </div>

            <div className="manual-field manual-field--time">
              <label htmlFor={departureTimeId}>
                출발시간 <span className="manual-optional">선택</span>
              </label>
              <input
                id={departureTimeId}
                type="time"
                step={60}
                value={form.departureTime}
                onChange={(event) => {
                  setForm((current) => ({ ...current, departureTime: event.target.value }));
                  setErrors((current) => {
                    const next = { ...current };
                    delete next.departureTime;
                    return next;
                  });
                }}
                disabled={isSaving}
                aria-invalid={Boolean(departureTimeError)}
                aria-describedby={`${departureTimeId}-help${departureTimeError ? ` ${departureTimeId}-error` : ''}`}
                data-error={Boolean(departureTimeError) || undefined}
              />
              <p id={`${departureTimeId}-help`} className="manual-field-help">
                출발 공항의 현지 시각
              </p>
              {departureTimeError && (
                <p id={`${departureTimeId}-error`} className="manual-field-error" role="alert">
                  {departureTimeError}
                </p>
              )}
            </div>
          </div>

          <AirportField
            role="departure"
            label="출발 공항"
            draft={form.departure}
            catalog={catalog}
            catalogLoading={catalogLoading}
            catalogError={catalogError}
            errors={errors}
            disabled={isSaving}
            onChange={(draft) => updateAirport('departure', draft)}
          />

          <div className="manual-route-divider" aria-hidden="true"><span>→</span></div>

          <AirportField
            role="arrival"
            label="도착 공항"
            draft={form.arrival}
            catalog={catalog}
            catalogLoading={catalogLoading}
            catalogError={catalogError}
            errors={errors}
            disabled={isSaving}
            onChange={(draft) => updateAirport('arrival', draft)}
          />

          {inferredType && (
            <p className="manual-classification-note" aria-live="polite">
              공항 국가 코드를 기준으로 <strong>{inferredType}</strong>으로 저장됩니다.
            </p>
          )}

          {showExplicitType && (
            <fieldset
              className="manual-type-field"
              aria-required="true"
              aria-describedby={typeError ? `${formId}-type-error` : undefined}
            >
              <legend>비행 구분 <span aria-hidden="true">*</span></legend>
              <p>국가 코드가 없어 자동으로 구분할 수 없습니다.</p>
              <div className="manual-segmented">
                {(['국내선', '국제선'] as const).map((type) => (
                  <label key={type}>
                    <input
                      type="radio"
                      name={`${formId}-type`}
                      value={type}
                      checked={form.explicitType === type}
                      onChange={() => {
                        setForm((current) => ({ ...current, explicitType: type }));
                        setErrors((current) => {
                          const next = { ...current };
                          delete next.type;
                          return next;
                        });
                      }}
                      disabled={isSaving}
                      required
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
              {typeError && <p id={`${formId}-type-error`} className="manual-field-error">{typeError}</p>}
            </fieldset>
          )}

          <div className="manual-form-grid manual-form-grid--optional">
            <AirlineCombobox
              value={form.airline}
              selection={form.airlineSelection}
              catalog={airlineCatalog}
              catalogLoading={airlineCatalogLoading}
              catalogError={airlineCatalogError}
              history={suggestions.airline}
              disabled={isSaving}
              onChange={(airline, airlineSelection) => {
                setForm((current) => ({
                  ...current,
                  airline,
                  airlineSelection,
                }));
              }}
            />
            <OptionalTextField
              id={flightNumberId}
              label="편명"
              value={form.flightNumber}
              listId={flightNumberListId}
              disabled={isSaving}
              onChange={(value) => setForm((current) => ({ ...current, flightNumber: value }))}
            />
            <OptionalTextField
              id={aircraftId}
              label="기종"
              value={form.aircraft}
              listId={aircraftListId}
              disabled={isSaving}
              onChange={(value) => setForm((current) => ({ ...current, aircraft: value }))}
            />
          </div>

          <datalist id={flightNumberListId}>{suggestions.flightNumber.map((value) => <option key={value} value={value} />)}</datalist>
          <datalist id={aircraftListId}>{suggestions.aircraft.map((value) => <option key={value} value={value} />)}</datalist>
        </form>
      </DialogShell>

      <ConfirmDialog
        open={discardOpen}
        title="작성 중인 내용을 버릴까요?"
        description="저장하지 않은 변경 내용은 복구할 수 없습니다."
        confirmLabel="변경 내용 버리기"
        tone="danger"
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          onRequestClose();
        }}
      />
    </>
  );
}
