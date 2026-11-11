import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { useRootContext } from "@/context/RootContext";
import DataModeBadge from "@/components/market/DataModeBadge";
import { marketApi } from "@/lib/marketClient";
import { filterDemoInstruments } from "@/lib/search";
import { nextIndex } from "@/lib/search";

interface GlobalSearchProps {
  onOpenInstrument: (instrumentId: string) => void;
}

interface ResultRow {
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: string;
  instrumentType: string;
}

/**
 * Instrument search available from every page.
 *
 * Ctrl/⌘+K opens it, ArrowUp/ArrowDown move the highlight, Enter opens the
 * selected instrument and Escape closes without navigating. While the backend is
 * unreachable the dialog searches the deterministic demo catalogue instead, and
 * says so — it never implies a server search ran.
 */
const GlobalSearch: React.FC<GlobalSearchProps> = ({ onOpenInstrument }) => {
  const { backendOnline } = useRootContext();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      if (!isShortcut) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        className="ml-search-trigger"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K Meta+K"
        data-testid="global-search-trigger"
      >
        <span aria-hidden="true">⌕</span>
        <span className="ml-search-trigger-label">Search instruments</span>
        <kbd className="ml-kbd">⌘K</kbd>
      </button>

      {open &&
        (backendOnline ? (
          <SearchDialogLive onClose={close} onOpenInstrument={onOpenInstrument} />
        ) : (
          <SearchDialogDemo onClose={close} onOpenInstrument={onOpenInstrument} />
        ))}
    </>
  );
};

interface DialogProps {
  onClose: () => void;
  onOpenInstrument: (instrumentId: string) => void;
}

const SearchShell: React.FC<{
  onClose: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  rows: ResultRow[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (row: ResultRow) => void;
  loading: boolean;
  emptyMessage: string;
  footer: React.ReactNode;
  sampleOnly?: boolean;
}> = ({
  onClose,
  query,
  onQueryChange,
  rows,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  loading,
  emptyMessage,
  footer,
  sampleOnly,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onActiveIndexChange(nextIndex(activeIndex, rows.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      onActiveIndexChange(nextIndex(activeIndex, rows.length, -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[activeIndex] ?? rows[0];
      if (row) onSelect(row);
    }
  };

  return (
    <div className="ml-search-overlay" role="presentation" onClick={onClose}>
      <div
        className="ml-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search instruments"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ml-search-input-row">
          <span aria-hidden="true" className="ml-search-icon">
            ⌕
          </span>
          <input
            ref={inputRef}
            className="ml-search-input"
            placeholder="Search by symbol or company name"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onInputKeyDown}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={
              activeIndex >= 0 && rows[activeIndex] ? `global-search-${activeIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-label="Search instruments"
            data-testid="global-search-input"
          />
          <button type="button" className="ml-search-close" onClick={onClose} aria-label="Close search">
            Esc
          </button>
        </div>

        <ul id="global-search-results" role="listbox" className="ml-search-results">
          {loading && rows.length === 0 && <li className="ml-search-status">Searching…</li>}
          {!loading && rows.length === 0 && (
            <li className="ml-search-status" data-testid="global-search-empty">
              {emptyMessage}
            </li>
          )}
          {rows.map((row, index) => (
            <li key={row.instrumentId} role="presentation">
              <button
                id={`global-search-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`ml-search-item${index === activeIndex ? " is-active" : ""}`}
                onMouseEnter={() => onActiveIndexChange(index)}
                onClick={() => onSelect(row)}
              >
                <span className="ml-search-symbol">{row.symbol}</span>
                <span className="ml-search-name">{row.name}</span>
                <span className="ml-search-meta">
                  {row.exchange} · {row.instrumentType}
                  {sampleOnly && <DataModeBadge mode="SAMPLE" source="sample" />}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="ml-search-footer">{footer}</p>
      </div>
    </div>
  );
};

const SearchDialogLive: React.FC<DialogProps> = ({ onClose, onOpenInstrument }) => {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const result = useQuery(marketApi.searchInstruments, {
    search: debounced,
    exchange: "ALL",
    limit: 10,
  });

  const rows = useMemo<ResultRow[]>(
    () =>
      (result?.items ?? []).map((row) => ({
        instrumentId: row.instrumentId ?? `${row.exchange}:${row.symbol}:${row.instrumentType}`,
        symbol: row.symbol,
        name: row.name,
        exchange: row.exchange,
        instrumentType: row.instrumentType,
      })),
    [result]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [debounced]);

  const select = (row: ResultRow) => {
    onOpenInstrument(row.instrumentId);
    onClose();
  };

  return (
    <SearchShell
      onClose={onClose}
      query={query}
      onQueryChange={setQuery}
      rows={rows}
      activeIndex={activeIndex}
      onActiveIndexChange={setActiveIndex}
      onSelect={select}
      loading={result === undefined}
      emptyMessage={
        debounced
          ? `No instrument matches “${debounced}”. Try a symbol such as RELIANCE.`
          : "No instruments in the catalogue yet. Sync the instrument master from Data Sources."
      }
      footer={
        <>
          {rows.length} result{rows.length === 1 ? "" : "s"} · ↑ ↓ to move · Enter to open · Esc to
          close
        </>
      }
    />
  );
};

const SearchDialogDemo: React.FC<DialogProps> = ({ onClose, onOpenInstrument }) => {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const rows = useMemo<ResultRow[]>(
    () =>
      filterDemoInstruments(query, 10).map((instrument) => ({
        instrumentId: instrument.instrumentId,
        symbol: instrument.symbol,
        name: instrument.name,
        exchange: instrument.exchange,
        instrumentType: instrument.instrumentType,
      })),
    [query]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const select = (row: ResultRow) => {
    onOpenInstrument(row.instrumentId);
    onClose();
  };

  return (
    <SearchShell
      onClose={onClose}
      query={query}
      onQueryChange={setQuery}
      rows={rows}
      activeIndex={activeIndex}
      onActiveIndexChange={setActiveIndex}
      onSelect={select}
      loading={false}
      emptyMessage={`No sample instrument matches “${query.trim()}”.`}
      sampleOnly
      footer="Offline: searching the deterministic SAMPLE catalogue, not the full instrument master."
    />
  );
};

export default GlobalSearch;
