import React, {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { ArrowUpRight, Loader2, Search, X } from "lucide-react";
import { useRootContext } from "@/context/RootContext";
import DataModeBadge from "@/components/market/DataModeBadge";
import { marketApi } from "@/lib/marketClient";
import { filterDemoInstruments, nextIndex } from "@/lib/search";

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

const TYPE_LABEL: Record<string, string> = {
  EQUITY: "Equities",
  INDEX: "Indices",
  ETF: "ETFs",
};

/**
 * Splits the ranked result list into runs of the same instrument type so group
 * headers can be shown without reordering what the backend ranked. Returns one
 * group when the types are already mixed.
 */
const groupRows = (rows: ResultRow[]) => {
  const groups: { type: string; entries: { row: ResultRow; index: number }[] }[] = [];
  rows.forEach((row, index) => {
    const last = groups[groups.length - 1];
    if (last && last.type === row.instrumentType) last.entries.push({ row, index });
    else groups.push({ type: row.instrumentType, entries: [{ row, index }] });
  });
  return groups;
};

interface SearchShellProps {
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
}

/**
 * The command palette itself. Rendered through a portal on document.body so no
 * sidebar, chart or header stacking context can clip or trap it.
 */
const SearchShell: React.FC<SearchShellProps> = ({
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Focus the input, lock background scrolling, and hand focus back to whatever
  // opened the palette when it closes.
  useEffect(() => {
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      const target = restoreRef.current;
      if (target && typeof target.focus === "function") target.focus();
    };
  }, []);

  // Keep the highlight valid when an async result set shrinks under it.
  useEffect(() => {
    if (rows.length === 0) return;
    if (activeIndex < 0 || activeIndex >= rows.length) onActiveIndexChange(0);
  }, [rows.length, activeIndex, onActiveIndexChange]);

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "Tab") {
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!nodes || nodes.length === 0) return;
      // Rows are tabIndex={-1}: only genuinely tabbable controls count, or the
      // wrap target would be an element that can never hold focus.
      const list = Array.from(nodes).filter((node) => node.tabIndex >= 0);
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onActiveIndexChange(nextIndex(activeIndex, rows.length, 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onActiveIndexChange(nextIndex(activeIndex, rows.length, -1));
      return;
    }

    if (event.key === "Enter") {
      const target = event.target as HTMLElement | null;
      const isInput = target === inputRef.current;
      const isRow = target?.getAttribute?.("role") === "option";
      if (!isInput && !isRow) return;
      event.preventDefault();
      const row = rows[activeIndex] ?? rows[0];
      if (row) onSelect(row);
    }
  };

  const groups = useMemo(() => groupRows(rows), [rows]);
  const showGroupLabels = groups.length > 1 && groups.length <= 4;

  const renderRow = (row: ResultRow, index: number) => {
    const active = index === activeIndex;
    return (
      <li key={row.instrumentId} role="presentation">
        <button
          id={`global-search-${index}`}
          type="button"
          role="option"
          aria-selected={active}
          tabIndex={-1}
          className={`ml-palette-item${active ? " is-active" : ""}`}
          onMouseEnter={() => onActiveIndexChange(index)}
          onClick={() => onSelect(row)}
        >
          <span className="ml-palette-main">
            <span className="ml-palette-symbol">{row.symbol}</span>
            <span className="ml-palette-name">{row.name}</span>
          </span>
          <span className="ml-palette-side">
            <span className="ml-palette-exchange">{row.exchange}</span>
            <span className="ml-palette-type">{row.instrumentType}</span>
            <ArrowUpRight className="ml-palette-arrow" size={15} aria-hidden="true" />
          </span>
        </button>
      </li>
    );
  };

  const listItems: React.ReactNode[] = [];
  groups.forEach((group, groupIndex) => {
    if (showGroupLabels) {
      listItems.push(
        <li className="ml-palette-group" role="presentation" key={`group-${groupIndex}`}>
          {TYPE_LABEL[group.type] ?? group.type}
        </li>
      );
    }
    group.entries.forEach(({ row, index }) => listItems.push(renderRow(row, index)));
  });

  return (
    <div
      className="ml-palette-overlay"
      data-ml-overlay="search"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="ml-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search instruments"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <div className="ml-palette-head">
          <Search className="ml-palette-search-icon" size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            className="ml-palette-input"
            placeholder="Search stocks, indices, ETFs or symbols..."
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={
              activeIndex >= 0 && rows[activeIndex] ? `global-search-${activeIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-label="Search instruments"
            spellCheck={false}
            autoComplete="off"
            data-testid="global-search-input"
          />
          {sampleOnly ? <DataModeBadge mode="SAMPLE" source="sample" /> : null}
          {query ? (
            <button
              type="button"
              className="ml-palette-icon-btn"
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              data-testid="global-search-clear"
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : null}
          <kbd className="ml-kbd ml-palette-esc">Esc</kbd>
          <button
            type="button"
            className="ml-palette-icon-btn"
            onClick={onClose}
            aria-label="Close search"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="ml-palette-body">
          <ul id="global-search-results" role="listbox" className="ml-palette-list" aria-label="Instruments">
            {loading && rows.length === 0 && (
              <li className="ml-palette-status" role="presentation" data-testid="global-search-loading">
                <Loader2 className="ml-palette-spinner" size={15} aria-hidden="true" />
                Searching…
              </li>
            )}
            {!loading && rows.length === 0 && (
              <li className="ml-palette-status" role="presentation" data-testid="global-search-empty">
                {emptyMessage}
              </li>
            )}
            {listItems}
          </ul>
        </div>

        <div className="ml-palette-foot">{footer}</div>
      </div>
    </div>
  );
};

/** Result-agnostic dialog shown when the live query throws. */
const SearchFailure: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="ml-palette-overlay" data-ml-overlay="search" role="presentation" onClick={onClose}>
    <div
      className="ml-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Search instruments"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="ml-palette-head">
        <Search className="ml-palette-search-icon" size={18} aria-hidden="true" />
        <span className="ml-palette-input ml-palette-input--static">Instrument search</span>
        <button type="button" className="ml-palette-icon-btn" onClick={onClose} aria-label="Close search">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="ml-palette-body">
        <p className="ml-palette-error" data-testid="global-search-error">
          Instrument search is unavailable right now. The catalogue query failed, so no results can be
          shown. Nothing here is cached or invented.
        </p>
      </div>
      <div className="ml-palette-foot">
        <button type="button" className="ml-btn ml-btn--secondary ml-btn--sm" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  </div>
);

class SearchBoundary extends Component<
  { onClose: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Instrument search failed", error, info);
  }

  render() {
    if (this.state.failed) return <SearchFailure onClose={this.props.onClose} />;
    return this.props.children;
  }
}

interface DialogProps {
  onClose: () => void;
  onOpenInstrument: (instrumentId: string) => void;
}

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
          <span className="ml-palette-count">
            {rows.length} result{rows.length === 1 ? "" : "s"}
          </span>
          <span className="ml-palette-hints">
            <kbd className="ml-kbd">↑</kbd>
            <kbd className="ml-kbd">↓</kbd> move
            <kbd className="ml-kbd">↵</kbd> open
            <kbd className="ml-kbd">esc</kbd> close
          </span>
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
      footer={<span className="ml-palette-count">Offline · searching the deterministic SAMPLE catalogue only.</span>}
    />
  );
};

/**
 * Instrument search available from every page.
 *
 * Ctrl/⌘+K opens a portalled command palette, ArrowUp/ArrowDown move the
 * highlight, Enter opens the selected instrument and Escape closes without
 * navigating. While the backend is unreachable the palette searches the
 * deterministic demo catalogue and says so — it never implies a server search
 * ran.
 */
const GlobalSearch: React.FC<GlobalSearchProps> = ({ onOpenInstrument }) => {
  const { backendOnline } = useRootContext();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isShortcut =
        (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k";
      if (!isShortcut) return;

      const target = event.target;
      const ownOverlay = document.querySelector('[data-ml-overlay="search"]');
      const insideOwnOverlay = target instanceof Node && ownOverlay?.contains(target) === true;

      // Do not steal the shortcut from a text field or from another dialog.
      if (!insideOwnOverlay && target instanceof HTMLElement) {
        if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      }
      if (document.querySelector('[data-ml-overlay]:not([data-ml-overlay="search"])')) return;

      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const portalTarget = typeof document !== "undefined" ? document.body : null;

  return (
    <>
      <button
        type="button"
        className="ml-search-trigger"
        onClick={() => setOpen(true)}
        aria-label="Search instruments"
        aria-keyshortcuts="Control+K Meta+K"
        data-testid="global-search-trigger"
      >
        <Search size={14} aria-hidden="true" className="ml-search-trigger-icon" />
        <span className="ml-search-trigger-label">Search instruments</span>
        <kbd className="ml-kbd">⌘K</kbd>
      </button>

      {open && portalTarget
        ? createPortal(
            backendOnline ? (
              <SearchBoundary onClose={close}>
                <SearchDialogLive onClose={close} onOpenInstrument={onOpenInstrument} />
              </SearchBoundary>
            ) : (
              <SearchDialogDemo onClose={close} onOpenInstrument={onOpenInstrument} />
            ),
            portalTarget
          )
        : null}
    </>
  );
};

export default GlobalSearch;
