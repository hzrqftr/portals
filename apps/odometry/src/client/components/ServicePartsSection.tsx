import type { MaintenanceRow, PartType } from "../api/hooks";
import { formatKm } from "../lib/format";
import { CustomPartDialog } from "./CustomPartDialog";
import { PartPicker } from "./PartPicker";
import { ServiceItemRow, type ItemDraft } from "./ServiceItemRow";

/**
 * The "Parts replaced" half of ServiceSheet: the line items, the headline they
 * derive, and the two mutually exclusive ways to add another.
 *
 * Split out for the same reason ServiceSaved was -- the sheet grew past the
 * size guide when it gained an edit mode, and this is the block with the
 * clearest seam. It owns no state: the draft lives in the sheet, because a
 * part added here changes the total shown there.
 */
export function ServicePartsSection({
  items,
  partTypes,
  maintenance,
  odometerKm,
  nextService,
  defaultNextDueKm,
  addingCustom,
  onAddingCustomChange,
  onAddPart,
  onChangeItem,
  onRemoveItem,
}: {
  items: ItemDraft[];
  partTypes: PartType[];
  maintenance: MaintenanceRow[];
  odometerKm: number | null;
  nextService: number | undefined;
  defaultNextDueKm: (partTypeId: string) => number | null;
  addingCustom: boolean;
  onAddingCustomChange: (adding: boolean) => void;
  /** `name` is passed only for a part type created seconds ago, whose fetch has not landed. */
  onAddPart: (partTypeId: string, name?: string) => void;
  onChangeItem: (next: ItemDraft) => void;
  onRemoveItem: (key: string) => void;
}) {
  return (
    <>
      <h3 className="mt-6 text-sm font-medium uppercase tracking-wider text-ink-faint">
        Parts replaced
      </h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          None yet. A visit with no parts is a valid record &mdash; it just resets no
          maintenance clocks.
        </p>
      ) : (
        <>
          {nextService !== undefined && (
            <p className="mt-2 text-sm text-ink-muted">
              Next service at <strong>{formatKm(nextService)}</strong>
            </p>
          )}
          <ul className="mt-2 space-y-2">
            {items.map((item) => (
              <ServiceItemRow
                key={item.key}
                item={item}
                partTypeCode={partTypes.find((p) => p.id === item.partTypeId)?.code ?? ""}
                odometerKm={odometerKm}
                defaultNextDueKm={defaultNextDueKm(item.partTypeId)}
                onChange={onChangeItem}
                onRemove={() => onRemoveItem(item.key)}
              />
            ))}
          </ul>
        </>
      )}

      {addingCustom ? (
        <CustomPartDialog
          // usePartTypes is refetching when this fires, so nameOf() cannot
          // resolve the new id yet and addPart would label the row "Part".
          // The name is already in hand here, so pass it through.
          onCreated={(id, name) => {
            onAddPart(id, name);
            onAddingCustomChange(false);
          }}
          onCancel={() => onAddingCustomChange(false)}
        />
      ) : (
        <PartPicker
          partTypes={partTypes}
          maintenance={maintenance}
          exclude={items.map((i) => i.partTypeId)}
          onAdd={onAddPart}
          onAddCustom={() => onAddingCustomChange(true)}
        />
      )}
    </>
  );
}
