import {
  usePartTypes,
  useServiceTemplates,
  usePutServiceTemplate,
  type ServiceTypeName,
} from "../api/hooks";
import { INPUT } from "./form";

/**
 * Which parts a service type pre-fills in the log-service form.
 *
 * A template only decides what the form STARTS with. Every line can be
 * removed before saving, and no maintenance clock moves until a line item is
 * actually recorded (invariant 7) -- so getting a template slightly wrong
 * costs a tap, not a wrong due date.
 *
 * Edits save immediately. The list is the whole value, so there is no
 * half-finished state worth a Save button.
 */
export function TemplateEditor({ serviceType }: { serviceType: ServiceTypeName }) {
  const partTypes = usePartTypes();
  const templates = useServiceTemplates();
  const put = usePutServiceTemplate();

  const current = (templates.data ?? [])
    .filter((t) => t.serviceType === serviceType)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const chosen = current.map((t) => t.partTypeId);
  const available = (partTypes.data ?? [])
    .filter((p) => !chosen.includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const write = (partTypeIds: string[]) => put.mutate({ serviceType, partTypeIds });

  return (
    <div className="mt-2">
      {current.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing pre-filled &mdash; parts get added by hand.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {current.map((t) => (
            <li
              key={t.partTypeId}
              className="inline-flex items-center gap-2 rounded-full bg-inset py-1 pl-3 pr-2 text-sm"
            >
              {t.partName}
              <button
                aria-label={`Remove ${t.partName}`}
                onClick={() => write(chosen.filter((id) => id !== t.partTypeId))}
                className="text-ink-faint"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      <select
        value=""
        disabled={put.isPending}
        onChange={(e) => e.target.value && write([...chosen, e.target.value])}
        className={INPUT + " mt-3"}
      >
        <option value="">+ Add a part</option>
        {available.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {put.isError && (
        <p className="mt-1 text-sm text-status-overdue-fg">{(put.error as Error).message}</p>
      )}
    </div>
  );
}
