/**
 * A row of tabs, underlined on the active one. Used twice on the vehicle page
 * -- Details | Grant at the top, Maintenance | Service history | Renewals |
 * Fuel below -- and shared so the two cannot drift apart in look or behaviour.
 *
 * The row scrolls sideways within itself rather than widening the page: four
 * tabs do not fit 375px, and labels never wrap onto two lines. Wrapping,
 * borders and stickiness are the caller's; this is only the row.
 */
export interface Tab<T extends string> {
  value: T;
  label: string;
  /** Shown faint beside the label, e.g. how many service records. */
  count?: number;
}

export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly Tab<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={
            "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition " +
            (value === t.value
              ? "border-ink font-medium text-ink"
              : "border-transparent text-ink-muted hover:text-ink")
          }
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 text-xs text-ink-faint">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
