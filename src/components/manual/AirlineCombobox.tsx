import {
  type KeyboardEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AirlineSearchCatalog,
  AirlineSearchEntry,
} from '../../lib/airlineSearch';
import {
  airlineOptionKey,
  airlineOptionValue,
  airlineOptions,
  type AirlineOption,
  nextAirlineOptionIndex,
} from './airlineComboboxModel';

export interface AirlineSelection {
  name: string;
  iata: string;
  icao: string;
  country?: string;
}

interface AirlineComboboxProps {
  value: string;
  selection: AirlineSelection | null;
  catalog: AirlineSearchCatalog | null;
  catalogLoading: boolean;
  catalogError: string;
  history: readonly string[];
  disabled: boolean;
  onChange: (value: string, selection: AirlineSelection | null) => void;
}

function optionName(option: AirlineOption): string {
  return option.kind === 'catalog' ? option.entry.name : option.name;
}

function entryMetadata(entry: AirlineSearchEntry): string {
  return [
    entry.iata ? `IATA ${entry.iata}` : '',
    entry.icao ? `ICAO ${entry.icao}` : '',
    entry.country,
  ].filter(Boolean).join(' · ');
}

export default function AirlineCombobox({
  value,
  selection,
  catalog,
  catalogLoading,
  catalogError,
  history,
  disabled,
  onChange,
}: AirlineComboboxProps) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-listbox`;
  const helpId = `${baseId}-help`;
  const statusId = `${baseId}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const options = useMemo(
    () => airlineOptions(catalog, history, value),
    [catalog, history, value],
  );
  const showResults = listOpen && !selection && value.trim() !== '';
  const activeOption = activeIndex >= 0 ? options[activeIndex] : undefined;
  const selectedEntry = selection
    ? catalog?.findBySnapshot(selection)
    : undefined;
  const selectedMetadata = [
    selection?.iata ? `IATA ${selection.iata}` : '',
    selection?.icao ? `ICAO ${selection.icao}` : '',
    selection?.country ?? selectedEntry?.country ?? '',
  ].filter(Boolean).join(' · ');

  const closeList = () => {
    setListOpen(false);
    setActiveIndex(-1);
  };

  const chooseOption = (option: AirlineOption) => {
    const chosen = airlineOptionValue(option);
    onChange(chosen.value, chosen.selection);
    closeList();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && showResults) {
      event.preventDefault();
      event.stopPropagation();
      closeList();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!options.length) return;
      event.preventDefault();
      setListOpen(true);
      setActiveIndex((current) => nextAirlineOptionIndex(
        current,
        options.length,
        event.key === 'ArrowDown' ? 'next' : 'previous',
      ));
      return;
    }

    if (event.key === 'Enter' && showResults && activeOption) {
      event.preventDefault();
      chooseOption(activeOption);
      return;
    }

    if (event.key === 'Tab') closeList();
  };

  return (
    <div
      className="manual-field manual-field--airline"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) closeList();
      }}
    >
      <label htmlFor={inputId}>
        항공사 <span className="manual-optional">선택</span>
      </label>
      <div className="manual-combobox-wrap">
        <input
          ref={inputRef}
          id={inputId}
          className="manual-combobox"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showResults}
          aria-controls={showResults ? listId : undefined}
          aria-activedescendant={showResults && activeOption
            ? `${baseId}-option-${activeIndex}`
            : undefined}
          aria-describedby={`${helpId}${catalogError ? ` ${statusId}` : ''}`}
          value={value}
          placeholder="항공사명, IATA 또는 ICAO 코드 검색"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onFocus={() => {
            if (!selection && value.trim()) setListOpen(true);
          }}
          onChange={(event) => {
            onChange(event.target.value, null);
            setListOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        {selection && (
          <button
            type="button"
            className="manual-combobox__clear"
            aria-label="선택한 항공사 변경"
            disabled={disabled}
            onClick={() => {
              onChange('', null);
              setListOpen(false);
              setActiveIndex(-1);
              inputRef.current?.focus();
            }}
          >
            변경
          </button>
        )}
      </div>

      <p id={helpId} className="manual-field-help">
        {catalogLoading
          ? '로컬 항공사 목록을 준비하고 있습니다.'
          : '목록에서 선택하면 코드가 함께 저장됩니다. 직접 입력해도 괜찮습니다.'}
      </p>
      {catalogError && (
        <p id={statusId} className="manual-field-note" role="status">
          {catalogError} 직접 입력은 계속 사용할 수 있습니다.
        </p>
      )}

      {selection && (
        <div className="manual-airline-selection" aria-live="polite">
          <strong>{selection.name}</strong>
          <span>{selectedMetadata || '등록 코드 없음'}</span>
        </div>
      )}

      {showResults && (
        <ul
          id={listId}
          className="manual-airline-results"
          role="listbox"
          aria-label="항공사 검색 결과"
        >
          {options.map((option, index) => (
            <li
              id={`${baseId}-option-${index}`}
              key={airlineOptionKey(option, index)}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'is-active' : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => chooseOption(option)}
            >
              <strong>{optionName(option)}</strong>
              <span>
                {option.kind === 'catalog'
                  ? entryMetadata(option.entry) || '등록 코드 없음'
                  : '현재 세션에서 직접 입력한 항공사'}
              </span>
            </li>
          ))}
          {!catalogLoading && options.length === 0 && (
            <li className="manual-airline-results__empty" role="option" aria-disabled="true">
              일치하는 항공사가 없습니다. 입력한 이름을 그대로 저장할 수 있습니다.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
