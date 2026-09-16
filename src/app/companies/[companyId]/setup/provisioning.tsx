"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";

type CategoryComponent = {
  id: string;
  group: "VEHICLE_CATEGORY";
  code: string;
  name: string;
  requiredLicenceClass: string | null;
};
type ComplianceComponent = {
  id: string;
  group: "COMPLIANCE";
  documentType: {
    code: string;
    name: string;
    subjectType: string;
    evidenceSourceType: string;
    requiresIssueDate: boolean;
    requiresExpiryDate: boolean;
  };
  requirement: { name: string; expiryWarningDays: number; applicability: string };
};
type InspectionComponent = {
  id: string;
  group: "INSPECTION";
  code: string;
  name: string;
  sections: Array<{ title: string; questions: Array<{ label: string }> }>;
};
type Component = CategoryComponent | ComplianceComponent | InspectionComponent;
type Outcome = {
  id: string;
  group: Component["group"];
  label: string;
  status: "CREATE" | "ALREADY_PRESENT" | "CONFLICT" | "SKIP";
  detail: string;
};
type FetchOptions = NonNullable<Parameters<typeof fetch>[1]>;

async function json<T>(url: string, init?: FetchOptions): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body;
}

function componentName(component: Component) {
  return component.group === "COMPLIANCE" ? component.requirement.name : component.name;
}

function ComponentDetails({ component }: Readonly<{ component: Component }>) {
  if (component.group === "VEHICLE_CATEGORY")
    return (
      <span>
        Code: {component.code} · Required licence:{" "}
        {component.requiredLicenceClass ?? "Not specified"}
      </span>
    );
  if (component.group === "COMPLIANCE")
    return (
      <span>
        {component.documentType.name} · {component.documentType.subjectType} · Issue date:{" "}
        {component.documentType.requiresIssueDate ? "Expected" : "Not expected"} · Expiry date:{" "}
        {component.documentType.requiresExpiryDate ? "Expected" : "Not expected"} · Warning:{" "}
        {component.requirement.expiryWarningDays} days · {component.requirement.applicability}
      </span>
    );
  return (
    <div>
      <p>
        {component.sections.length} sections ·{" "}
        {component.sections.reduce((total, section) => total + section.questions.length, 0)}
        pass/fail questions · Applies to all eligible vehicles · Non-blocking impact
      </p>
      <ul className="starter-content-list">
        {component.sections.map((section) => (
          <li key={section.title}>
            <b>{section.title}:</b> {section.questions.map((question) => question.label).join(" ")}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PilotProvisioning({
  companyId,
  onApplied,
}: Readonly<{ companyId: string; onApplied: () => Promise<void> }>) {
  const endpoint = `/api/companies/${companyId}/setup/provisioning`;
  const [components, setComponents] = useState<Component[]>([]);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    const result = await json<{ data: { notice: string; components: Component[] } }>(endpoint);
    setComponents(result.data.components);
    setNotice(result.data.notice);
  }, [endpoint]);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Unable to load starter configuration"),
    );
  }, [load]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
    setOutcomes(null);
    setPreviewReady(false);
    setConfirmed(false);
    setSuccess("");
  }

  async function preview() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await json<{ data: Outcome[] }>(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ componentIds: selected }),
      });
      setOutcomes(result.data);
      setPreviewReady(true);
      setConfirmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to preview starter configuration");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!confirmed || !outcomes) return;
    setBusy(true);
    setError("");
    try {
      const result = await json<{ data: { outcomes: Outcome[] } }>(`${endpoint}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          componentIds: selected,
          confirmed: true,
          preview: selectedOutcomes.map(({ id, status }) => ({ id, status })),
        }),
      });
      setOutcomes(result.data.outcomes);
      setPreviewReady(false);
      setConfirmed(false);
      setSuccess("Selected starter configuration applied. Readiness has been refreshed.");
      await onApplied();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to apply starter configuration");
    } finally {
      setBusy(false);
    }
  }

  const selectedOutcomes = outcomes?.filter((item) => selected.includes(item.id)) ?? [];
  const hasCreate = selectedOutcomes.some((item) => item.status === "CREATE");

  return (
    <section className="panel" id="guided-provisioning">
      <p className="eyebrow">Guided provisioning</p>
      <h2>Optional pilot starter configuration</h2>
      <p className="muted">
        Select only the operational foundations your company wants. Nothing is created until you
        preview and explicitly confirm.
      </p>
      {notice ? <p className="message warning">{notice}</p> : null}
      {error ? (
        <p className="message error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="message success" role="status">
          {success}
        </p>
      ) : null}
      <div className="provisioning-list">
        {components.map((component) => (
          <label className="provisioning-option" key={component.id}>
            <input
              type="checkbox"
              checked={selected.includes(component.id)}
              onChange={() => toggle(component.id)}
            />
            <div className="provisioning-copy">
              <small>{component.group.replaceAll("_", " ")}</small>
              <strong>{componentName(component)}</strong>
              <ComponentDetails component={component} />
            </div>
          </label>
        ))}
      </div>
      <button type="button" onClick={() => void preview()} disabled={busy || selected.length === 0}>
        Preview selected configuration
      </button>
      {outcomes ? (
        <div className="provisioning-preview">
          <h3>Preview</h3>
          <p className="muted">This preview has not changed company configuration.</p>
          {selectedOutcomes.map((outcome) => (
            <article key={outcome.id}>
              <b className={`provisioning-${outcome.status.toLowerCase()}`}>
                {outcome.status.replaceAll("_", " ")}
              </b>
              <span>
                <strong>{outcome.label}</strong>
                <small>{outcome.detail}</small>
              </span>
            </article>
          ))}
          {hasCreate && previewReady ? (
            <>
              <label className="confirmation-row">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I reviewed this preview and want to apply the selected starter configuration.
              </label>
              <button
                className="primary"
                type="button"
                disabled={busy || !confirmed}
                onClick={() => void apply()}
              >
                Apply selected configuration
              </button>
            </>
          ) : hasCreate ? (
            <p className="muted">
              Applied results are shown above. Preview again before another application.
            </p>
          ) : (
            <p className="muted">
              There is nothing safe to create. Resolve conflicts manually or change the selection.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
