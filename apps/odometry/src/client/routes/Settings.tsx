import { useState } from "react";
import { useMe, useUpdateSettings, type Settings as SettingsShape } from "../api/hooks";
import { Page, AppHeader, SectionTitle } from "../components/Layout";
import { TemplateEditor } from "../components/TemplateEditor";
import { INPUT, Field, digitsOnly } from "@portals/core/client";

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

  if (me.isLoading) return <p className="p-6 text-ink-faint">Loading&hellip;</p>;
  if (!me.data) return <p className="p-6 text-status-overdue-fg">Could not load settings.</p>;

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

  const numberField = (key: keyof SettingsShape, label: string) => (
    <Field label={label}>
      <input
        type="text"
        inputMode="numeric"
        value={String(value(key))}
        onChange={(e) => num(key)(e.target.value)}
        className={INPUT + " tabular-nums"}
      />
    </Field>
  );

  const dirty = Object.keys(draft).length > 0;

  return (
    <>
      <AppHeader crumb="Settings" />
      <Page>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Settings</h1>

        <section className="mt-8 max-w-3xl">
          <SectionTitle>When to warn me</SectionTitle>
          {/* Four short numeric fields. One per row is needless scrolling on a
              wide screen, so they pair up as soon as there is room for it. */}
          <div className="grid gap-x-6 sm:grid-cols-2">
            {numberField("dueSoonDays", "Warn me this many days before something is due")}
            {numberField("dueSoonKm", "…or this many km before a part reaches its interval")}
            {numberField(
              "staleOdometerDays",
              "Warn me when an odometer reading is this many days old",
            )}
            {numberField(
              "fallbackKmPerDay",
              "Assume this many km a day before there is enough history to measure",
            )}
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            That last one is only used for a vehicle with fewer than two odometer readings two
            weeks apart. Predictions made that way are labelled &ldquo;estimated&rdquo;.
          </p>
        </section>

        <section className="mt-10 max-w-3xl">
          <SectionTitle>Regional</SectionTitle>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <div>
              <Field label="Timezone">
                <input
                  value={value("timezone")}
                  onChange={(e) => set("timezone", e.target.value)}
                  className={INPUT}
                />
              </Field>
              <p className="mt-2 text-xs text-ink-faint">
                Every &ldquo;today&rdquo; in the app is worked out from this. A wrong value
                shifts every due date by a day.
              </p>
            </div>
            <Field label="Currency">
              <input
                value={value("currency")}
                onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))}
                className={INPUT}
              />
            </Field>
          </div>
        </section>

        <section className="mt-10 max-w-3xl">
          <SectionTitle>What a service includes</SectionTitle>
          <p className="mt-2 text-sm text-ink-muted">
            Picking a service type fills these in for you. You can still add or remove parts on
            the day.
          </p>

          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="font-medium">Minor service</h3>
              <TemplateEditor serviceType="minor" />
            </div>
            <div>
              <h3 className="font-medium">Major service</h3>
              <TemplateEditor serviceType="major" />
            </div>
          </div>
        </section>

        {save.isError && (
          <p className="mt-4 text-sm text-status-overdue-fg">{(save.error as Error).message}</p>
        )}

        <button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(draft, { onSuccess: () => setDraft({}) })}
          className="mt-8 w-full rounded-xl bg-ink py-3 font-medium text-page disabled:opacity-40 sm:w-auto sm:px-8"
        >
          {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </Page>
    </>
  );
}
