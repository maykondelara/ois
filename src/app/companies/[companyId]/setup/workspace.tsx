"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Profile = { id: string; name: string; slug: string; timezone: string; status: string };
type Settings = {
  odometerExpectedIncreaseThresholdKm: number;
  inspectionVehicleSelectionStrategy: string;
};
type Category = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  requiredLicenceClass: string | null;
};
type Readiness = {
  state: "NOT_STARTED" | "IN_PROGRESS" | "READY";
  checks: Record<
    | "companyProfile"
    | "operationalSettings"
    | "vehicleCategory"
    | "driver"
    | "vehicle"
    | "complianceRequirement"
    | "publishedInspection",
    boolean
  >;
  facts: {
    categoryCount: number;
    driverCount: number;
    vehicleCount: number;
    requirementCount: number;
    templateCount: number;
  };
};
type Capabilities = {
  canManageCompany: boolean;
  canManageVehicles: boolean;
  canManageCompliance: boolean;
  canConfigureInspections: boolean;
};
type FetchOptions = NonNullable<Parameters<typeof fetch>[1]>;

async function json<T>(url: string, init?: FetchOptions): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body;
}
const send = (method: string, body: unknown): FetchOptions => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const steps = [
  [
    "companyProfile",
    "Company profile",
    "Confirm the operating name and company-local timezone.",
    "#company-profile",
  ],
  [
    "operationalSettings",
    "Operational settings",
    "Review odometer anomaly handling and vehicle selection.",
    "#operational-settings",
  ],
  [
    "vehicleCategory",
    "Vehicle categories",
    "Define operational vehicle types and any required licence class.",
    "#vehicle-categories",
  ],
  ["driver", "Initial drivers", "Add at least one real driver for pilot operations.", "/drivers"],
  [
    "vehicle",
    "Initial vehicles",
    "Add at least one real vehicle using an operational category.",
    "/vehicles",
  ],
  [
    "complianceRequirement",
    "Compliance foundation",
    "Configure at least one applicable compliance requirement.",
    "/compliance",
  ],
  [
    "publishedInspection",
    "Inspection foundation",
    "Publish at least one usable inspection checklist.",
    "#inspection-foundation",
  ],
] as const;

export default function SetupWorkspace({ companyId }: Readonly<{ companyId: string }>) {
  const base = `/api/companies/${companyId}`;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({
    canManageCompany: false,
    canManageVehicles: false,
    canManageCompliance: false,
    canConfigureInspections: false,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [setupResult, profileResult, settingsResult, categoryResult] = await Promise.all([
        json<{ data: Readiness; capabilities: Capabilities }>(`${base}/setup`),
        json<{ data: Profile }>(`${base}/company-profile`),
        json<{ data: Settings }>(`${base}/operational-settings`),
        json<{ data: Category[] }>(`${base}/vehicle-categories?includeInactive=true`),
      ]);
      setReadiness(setupResult.data);
      setCapabilities(setupResult.capabilities);
      setProfile(profileResult.data);
      setSettings(settingsResult.data);
      setCategories(categoryResult.data);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Unable to load company setup"),
    );
  }, [load]);

  async function mutate(url: string, init: FetchOptions, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await json(url, init);
      setNotice(message);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Setup update failed");
    } finally {
      setBusy(false);
    }
  }

  async function createInspection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const created = await json<{
        data: { template: { id: string }; draftVersion: { id: string } };
      }>(
        `${base}/inspections/templates`,
        send("POST", {
          code: form.get("code"),
          name: form.get("name"),
          description: form.get("description") || null,
        }),
      );
      const templateId = created.data.template.id;
      const versionId = created.data.draftVersion.id;
      const section = await json<{ data: { id: string } }>(
        `${base}/inspections/templates/${templateId}/versions/${versionId}/sections`,
        send("POST", { title: form.get("sectionTitle"), description: null, sortOrder: 1 }),
      );
      await json(
        `${base}/inspections/templates/${templateId}/versions/${versionId}/questions`,
        send("POST", {
          sectionId: section.data.id,
          label: form.get("questionLabel"),
          isRequired: true,
          responseType: "PASS_FAIL",
          sortOrder: 1,
          commentRule: "OPTIONAL",
          photoRequirement: "NEVER",
        }),
      );
      await json(`${base}/inspections/templates/${templateId}/versions/${versionId}/publish`, {
        method: "POST",
      });
      setNotice("Inspection checklist created and published.");
      await load();
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create inspection checklist");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="operations-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Pilot onboarding</p>
          <h1>Company setup</h1>
          <p className="page-intro">
            Configure the minimum operational foundation for a real OIS pilot. You can leave and
            return at any time.
          </p>
        </div>
        {readiness ? (
          <b className={`readiness readiness-${readiness.state.toLowerCase()}`}>
            {readiness.state.replaceAll("_", " ")}
          </b>
        ) : null}
      </header>
      {error ? (
        <p className="message error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="message success" role="status">
          {notice}
        </p>
      ) : null}
      {loading || !readiness || !profile || !settings ? (
        <p className="panel empty-state">Loading company setup…</p>
      ) : (
        <>
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Readiness</p>
                <h2>
                  {readiness.state === "READY" ? "Pilot foundation is ready" : "Setup checklist"}
                </h2>
              </div>
              <button className="quiet" onClick={() => void load()}>
                Refresh
              </button>
            </div>
            <p className="muted">
              Readiness is derived from current company records. It is not a score and is not stored
              separately.
            </p>
            <div className="setup-checklist">
              {steps.map(([key, title, description, target]) => {
                const complete = readiness.checks[key];
                const href = target.startsWith("#") ? target : `/companies/${companyId}${target}`;
                return (
                  <a href={href} className="setup-step" key={key}>
                    <b className={complete ? "check-complete" : "check-missing"}>
                      {complete ? "Complete" : "Required"}
                    </b>
                    <span>
                      <strong>{title}</strong>
                      <small>{description}</small>
                    </span>
                    <em>{complete ? "Review" : "Configure"} →</em>
                  </a>
                );
              })}
            </div>
          </section>
          <section className="panel" id="company-profile">
            <p className="eyebrow">Step 1</p>
            <h2>Company profile</h2>
            <p className="muted">
              The timezone controls business-date and expiry calculations. The company identifier
              and slug remain managed by the bootstrap process.
            </p>
            <form
              className="stack-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void mutate(
                  `${base}/company-profile`,
                  send("PATCH", { name: form.get("name"), timezone: form.get("timezone") }),
                  "Company profile updated.",
                );
              }}
            >
              <div className="form-grid">
                <label>
                  Company name
                  <input
                    name="name"
                    defaultValue={profile.name}
                    required
                    disabled={!capabilities.canManageCompany}
                  />
                </label>
                <label>
                  Company timezone
                  <input
                    name="timezone"
                    defaultValue={profile.timezone}
                    placeholder="Australia/Perth"
                    required
                    disabled={!capabilities.canManageCompany}
                  />
                </label>
                <label>
                  Company slug
                  <input value={profile.slug} disabled />
                </label>
                <label>
                  Company status
                  <input value={profile.status} disabled />
                </label>
              </div>
              {capabilities.canManageCompany ? (
                <button className="primary" disabled={busy}>
                  Save company profile
                </button>
              ) : (
                <p className="muted">You do not have company administration access.</p>
              )}
            </form>
          </section>
          <section className="panel" id="operational-settings">
            <p className="eyebrow">Step 2</p>
            <h2>Operational settings</h2>
            <form
              className="stack-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void mutate(
                  `${base}/operational-settings`,
                  send("PATCH", {
                    odometerExpectedIncreaseThresholdKm: Number(form.get("threshold")),
                    inspectionVehicleSelectionStrategy: form.get("strategy"),
                  }),
                  "Operational settings saved.",
                );
              }}
            >
              <div className="form-grid">
                <label>
                  Odometer anomaly threshold (km)
                  <input
                    type="number"
                    min="1"
                    name="threshold"
                    defaultValue={settings.odometerExpectedIncreaseThresholdKm}
                    disabled={!capabilities.canManageCompany}
                  />
                </label>
                <label>
                  Inspection vehicle selection
                  <select
                    name="strategy"
                    defaultValue={settings.inspectionVehicleSelectionStrategy}
                    disabled={!capabilities.canManageCompany}
                  >
                    <option value="BOTH">Search/select or registration entry</option>
                    <option value="SEARCH_SELECT">Search/select only</option>
                    <option value="MANUAL_REGO">Registration entry only</option>
                  </select>
                </label>
              </div>
              <p className="muted">
                The odometer threshold triggers confirmation and review; it does not automatically
                reject a reading.
              </p>
              {capabilities.canManageCompany ? (
                <button disabled={busy}>Save operational settings</button>
              ) : null}
            </form>
          </section>
          <section className="panel" id="vehicle-categories">
            <p className="eyebrow">Step 3</p>
            <h2>Vehicle categories</h2>
            <p className="muted">
              Categories are operational vehicle types. The required licence class is a separate
              Australian legal classification.
            </p>
            <div className="summary-list">
              {categories.map((category) => (
                <article key={category.id}>
                  <strong>{category.name}</strong>
                  <span>
                    {category.code} · Required licence:{" "}
                    {category.requiredLicenceClass ?? "Not specified"}
                  </span>
                  <small>{category.isActive ? "Active" : "Inactive"}</small>
                </article>
              ))}
            </div>
            {capabilities.canManageVehicles ? (
              <form
                className="stack-form inset-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void mutate(
                    `${base}/vehicle-categories`,
                    send("POST", {
                      code: form.get("code"),
                      name: form.get("name"),
                      requiredLicenceClass: form.get("requiredLicenceClass") || null,
                    }),
                    "Vehicle category created.",
                  );
                  event.currentTarget.reset();
                }}
              >
                <h3>Add operational category</h3>
                <div className="form-grid">
                  <label>
                    Category code
                    <input name="code" placeholder="12_PALLET_TRUCK" required />
                  </label>
                  <label>
                    Display name
                    <input name="name" placeholder="12 Pallet Truck" required />
                  </label>
                  <label>
                    Required licence class
                    <select name="requiredLicenceClass">
                      <option value="">Not specified</option>
                      {["C", "LR", "MR", "HR", "HC", "MC"].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button disabled={busy}>Add category</button>
              </form>
            ) : null}
          </section>
          <section className="panel" id="inspection-foundation">
            <p className="eyebrow">Step 4</p>
            <h2>Inspection foundation</h2>
            {readiness.checks.publishedInspection ? (
              <p className="message success">
                At least one active published inspection checklist is available.
              </p>
            ) : (
              <p className="message error">No published inspection checklist is available yet.</p>
            )}
            <p className="muted">
              Create a minimal checklist from company-defined wording. This does not provide
              regulatory or legal assurance; expand it through the accepted inspection configuration
              APIs as pilot requirements are confirmed.
            </p>
            {capabilities.canConfigureInspections && !readiness.checks.publishedInspection ? (
              <form className="stack-form inset-form" onSubmit={createInspection}>
                <div className="form-grid">
                  <label>
                    Template code
                    <input name="code" placeholder="DAILY_PRESTART" required />
                  </label>
                  <label>
                    Checklist name
                    <input name="name" placeholder="Daily pre-start inspection" required />
                  </label>
                  <label>
                    Section title
                    <input name="sectionTitle" placeholder="Vehicle condition" required />
                  </label>
                  <label>
                    First pass/fail question
                    <input
                      name="questionLabel"
                      placeholder="Is the vehicle safe to operate?"
                      required
                    />
                  </label>
                </div>
                <label>
                  Description
                  <textarea name="description" placeholder="Purpose and use of this checklist" />
                </label>
                <button className="primary" disabled={busy}>
                  Create and publish checklist
                </button>
              </form>
            ) : null}
            <p>
              <a href={`/companies/${companyId}/inspections`}>Open Inspections</a>
            </p>
          </section>
          <section className="module-grid" aria-label="Continue operational setup">
            <a className="module-link" href={`/companies/${companyId}/drivers`}>
              <strong>Drivers</strong>
              <span>
                {readiness.facts.driverCount} configured. Add real pilot drivers and licences.
              </span>
              <b>Open Drivers →</b>
            </a>
            <a className="module-link" href={`/companies/${companyId}/vehicles`}>
              <strong>Vehicles</strong>
              <span>
                {readiness.facts.vehicleCount} configured. Add real vehicles and initial odometers.
              </span>
              <b>Open Vehicles →</b>
            </a>
            <a className="module-link" href={`/companies/${companyId}/compliance`}>
              <strong>Compliance</strong>
              <span>
                {readiness.facts.requirementCount} active requirements. Configure evidence types and
                applicability.
              </span>
              <b>Open Compliance →</b>
            </a>
          </section>
        </>
      )}
    </main>
  );
}
