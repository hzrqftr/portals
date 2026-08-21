import { useState } from "react";
import { Link } from "react-router-dom";
import { useMe, useUpdateSettings, type Settings as SettingsShape } from "../api/hooks";
import { TemplateEditor } from "../components/TemplateEditor";
import { INPUT, Field, digitsOnly } from "./../components/form";

/**
 * Spec 8.7. Everything here used to be a constant in the source.
 *
 * The labels are written as sentences rather than field names on purpose:
 * "due_soon_km = 1000" tells you nothing about what will change on screen,
 * and these values shift every date the app displays.
 */
export default function Settings() {
  const me = useMe();
  const save = useUpdateSettings();
  const [draft, setDraft] = useState<Partial<SettingsShape>>({});

  if (me.isLoading) return <p className="p-4 text-stone-500">Loading&hellip;</p>;
  if (!me.data) return <p className="p-4 text-red-700">Could not load settings.</p>;

  const current: SettingsShape = { ...me.data.settings, timezone: me.data.user.timezone };
  const value = <K extends keyof SettingsShape>(key: K): SettingsShape[K] =>
    (draft[key] ?? current[key]) as SettingsShape[K];
  const set = <K extends keyof SettingsShape>(key: K, v: SettingsShape[K]) =>
    setDraft((d) => ({ ...d, [key]: v }));

  const num = (key: keyof SettingsShape) => (raw: string) => {
    const digits = digitsOnly(raw);
    // Zod rejects 0 on all four of these -- the fallback rate is a divisor,
    // and a zero threshold is not a meaningful answer for the others.
    if (digits !== "") set(key, Number(digits) as never);
  };

  const dirty = Object.keys(draft).length > 0;

  return (
    <div className="mx-auto max-w-lg p-4 pb-24">
      <Link to="/" className="text-sm text-stone-500">
        &larr; Fleet
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Settings</h1>

      <section className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-stone-500">
          When to warn me
        </h2>

        <Field label="Warn me this many days before something is due">
          <input
            type="text"
            inputMode="numeric"
            value={String(value("dueSoonDays"))}
            onChange={(e) => num("dueSoonDays")(e.target.value)}
            className={INPUT + " tabular-nums"}
          />
        </Field>

        <Field label="…or this many km before a part reaches its interval">
          <input
            type="text"
            inputMode="numeric"
            value={String(value("dueSoonKm"))}
            onChange={(e) => num("dueSoonKm")(e.target.value)}
            className={INPUT + " tabular-nums"}
          />
        </Field>

        <Field label="Warn me when an odometer reading is this many days old">
          <input
            type="text"
            inputMode="numeric"
            value={String(value("staleOdometerDays"))}
            onChange={(e) => num("staleOdometerDays")(e.target.value)}
            className={INPUT + " tabular-nums"}
          />
        </Field>

        <Field label="Assume this many km a day before there is enough history to measure">
          <input
            type="text"
            inputMode="numeric"
            value={String(value("fallbackKmPerDay"))}
            onChange={(e) => num("fallbackKmPerDay")(e.target.value)}
            className={INPUT + " tabular-nums"}
          />
        </Field>
        <p className="mt-1 text-xs text-stone-500">
          Only used for a vehicle with fewer than two odometer readings two weeks apart.
          Predictions made this way are labelled &ldquo;estimated&rdquo;.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-stone-500">
          Regional
        </h2>

        <Field label="Timezone">
          <input
            value={value("timezone")}
            onChange={(e) => set("timezone", e.target.value)}
            className={INPUT}
          />
        </Field>
        <p className="mt-1 text-xs text-stone-500">
          Every &ldquo;today&rdquo; in the app is worked out from this. A wrong value shifts
          every due date by a day.
        </p>

        <Field label="Currency">
          <input
            value={value("currency")}
            onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))}
            className={INPUT}
          />
        </Field>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-stone-500">
          What a service includes
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          Picking a service type fills these in for you. You can still add or remove parts on
          the day.
        </p>

        <h3 className="mt-4 font-medium">Minor service</h3>
        <TemplateEditor serviceType="minor" />

        <h3 className="mt-6 font-medium">Major service</h3>
        <TemplateEditor serviceType="major" />
      </section>

      {save.isError && (
        <p className="mt-4 text-sm text-red-700">{(save.error as Error).message}</p>
      )}

      <button
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate(draft, { onSuccess: () => setDraft({}) })}
        className="mt-6 w-full rounded-xl bg-stone-900 py-3 font-medium text-white disabled:opacity-40"
      >
        {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
      </button>
    </div>
  );
}
