import { useState } from "react";
import { INPUT, Select, Sheet } from "@portals/core/client";
import { parseSen, senToInput } from "@portals/core";
import {
  useCreateFundMember,
  usePatchFundMember,
  useRecurring,
  type FundMember,
} from "../../api/hooks";

/**
 * Who pays into the fund. Names, not accounts -- nobody but the owner signs in.
 *
 * "Usual amount" only pre-fills the payment sheet. Changing it never touches a
 * past month, because every grid cell shows what was actually paid.
 *
 * "Paid by" links a member to a recurring entry in the personal ledger. From
 * then on each posting of that entry also records this member's contribution,
 * in the same write. Only the owner's own share has one.
 *
 * No delete: a member who leaves is marked as left, and their money stays in
 * the pot's history.
 */
export function MembersSheet({ members, onClose }: { members: FundMember[]; onClose: () => void }) {
  const create = useCreateFundMember();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("200.00");
  const amountSen = parseSen(amount);

  return (
    <Sheet title="Fund members" onClose={onClose}>
      <h2 className="pr-9 text-lg font-semibold">Fund members</h2>

      <ul className="mt-4 flex flex-col gap-3">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} />
        ))}
      </ul>

      <div className="mt-6 rounded-xl border border-dashed border-edge p-3">
        <p className="text-sm text-ink-muted">Add a member</p>
        <div className="mt-2 grid grid-cols-[1fr_7rem_auto] gap-2">
          <input
            className={INPUT}
            placeholder="Name"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={INPUT + " tabular-nums"}
            inputMode="decimal"
            aria-label="Usual amount in RM"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          />
          <button
            type="button"
            disabled={!name.trim() || amountSen === null || create.isPending}
            onClick={() =>
              create.mutate(
                { name: name.trim(), defaultSen: amountSen ?? 0 },
                { onSuccess: () => setName("") },
              )
            }
            className="rounded-xl bg-ink px-4 font-medium text-page disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {create.isError && (
          <p className="mt-2 text-sm text-status-overdue-fg">{(create.error as Error).message}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="mt-5 w-full rounded-xl border border-edge py-3 font-medium text-ink-muted hover:text-ink"
      >
        Done
      </button>
    </Sheet>
  );
}

function MemberRow({ member }: { member: FundMember }) {
  const patch = usePatchFundMember();
  const rules = useRecurring();
  const [amount, setAmount] = useState(senToInput(member.defaultSen));
  const amountSen = parseSen(amount);
  const amountChanged = amountSen !== null && amountSen !== member.defaultSen;

  const save = (p: Parameters<typeof patch.mutate>[0]["patch"]) =>
    patch.mutate({ id: member.id, patch: p });

  return (
    <li className={"rounded-xl border border-edge bg-inset p-3 " + (member.isActive ? "" : "opacity-60")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{member.name}</span>
        <button
          type="button"
          onClick={() => save({ isActive: !member.isActive })}
          className="text-xs text-ink-muted hover:text-ink"
        >
          {member.isActive ? "Mark as left" : "Mark as active"}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs text-ink-faint">
          Usual amount (RM)
          <div className="mt-1 flex gap-2">
            <input
              className={INPUT + " tabular-nums"}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            />
            {amountChanged && (
              <button
                type="button"
                onClick={() => save({ defaultSen: amountSen ?? 0 })}
                className="rounded-lg bg-ink px-3 text-sm text-page"
              >
                Save
              </button>
            )}
          </div>
        </label>

        <label className="text-xs text-ink-faint">
          Paid by recurring entry
          <Select
            className="mt-1"
            value={member.rule?.id ?? ""}
            onChange={(e) => save({ recurringRuleId: e.target.value || null })}
          >
            <option value="">No, recorded by hand</option>
            {rules.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.item}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {patch.isError && (
        <p className="mt-2 text-sm text-status-overdue-fg">{(patch.error as Error).message}</p>
      )}
    </li>
  );
}
