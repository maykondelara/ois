"use client";
/* eslint-disable no-unused-vars, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Issue = {
  id: string;
  vehicleId: string;
  inspectionSubmissionId: string;
  inspectionResponseId: string;
  operationalImpact: "NON_BLOCKING" | "VEHICLE_BLOCKING";
  isVehicleBlocking: boolean;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  vehicleRegistration: string | null;
  templateName: string | null;
  questionLabel: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  closedAt: string | null;
};
type Capabilities = { canManage: boolean; canResolve: boolean; canReleaseVehicle: boolean };
type History = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  occurredAt: string;
};
type Action = {
  id: string;
  actionType: string;
  description: string;
  notes: string | null;
  occurredAt: string;
};
type Detail = {
  issue: Issue;
  vehicle: { id: string; registrationDisplay: string; operationalStatus: string };
  history: History[];
  actions: Action[];
  holds: Array<{ id: string; isActive: boolean; createdAt: string; releasedAt: string | null }>;
};
type FetchOptions = NonNullable<Parameters<typeof fetch>[1]>;

async function json<T>(url: string, init?: FetchOptions): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body;
}
const post = (body: unknown): FetchOptions => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export default function IssuesWorkspace({ companyId }: Readonly<{ companyId: string }>) {
  const base = `/api/companies/${companyId}`;
  const [issues, setIssues] = useState<Issue[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({
    canManage: false,
    canResolve: false,
    canReleaseVehicle: false,
  });
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [blocking, setBlocking] = useState("");
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    const query = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (status) query.set("status", status);
    if (severity) query.set("severity", severity);
    if (blocking) query.set("blocking", blocking);
    try {
      const result = await json<{
        data: Issue[];
        capabilities: Capabilities;
        page: { hasNextPage: boolean };
      }>(`${base}/issues?${query}`);
      setIssues(result.data);
      setCapabilities(result.capabilities);
      setHasNextPage(result.page.hasNextPage);
    } finally {
      setLoading(false);
    }
  }, [base, blocking, page, severity, status]);

  const loadDetail = useCallback(
    async (issueId: string) => {
      const result = await json<{ data: Detail; capabilities: Capabilities }>(
        `${base}/issues/${issueId}`,
      );
      setDetail(result.data);
      setCapabilities(result.capabilities);
    },
    [base],
  );

  useEffect(() => {
    void loadList().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Unable to load issues"),
    );
  }, [loadList]);

  async function mutate(url: string, body: unknown, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await json(url, post(body));
      setNotice(success);
      await loadList();
      if (detail) await loadDetail(detail.issue.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }

  async function addAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    await mutate(
      `${base}/issues/${detail.issue.id}/actions`,
      {
        actionType: form.get("actionType"),
        description: form.get("description"),
        notes: form.get("notes") || null,
      },
      "Repair/action recorded.",
    );
    event.currentTarget.reset();
  }

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    await mutate(
      `${base}/issues/${detail.issue.id}/resolve`,
      { resolutionNotes: form.get("resolutionNotes") },
      "Issue resolved. Vehicle release remains a separate decision.",
    );
  }

  async function release(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    await mutate(
      `${base}/vehicles/${detail.issue.vehicleId}/release`,
      { reason: form.get("reason") },
      "Vehicle released from defect hold.",
    );
  }

  return (
    <main className="inspection-shell">
      <header className="inspection-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Issues &amp; defects</h1>
        </div>
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
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Defect register</p>
            <h2>Inspection-generated issues</h2>
          </div>
          <button className="quiet" onClick={() => void loadList()}>
            Refresh
          </button>
        </div>
        <div className="filter-row">
          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option>OPEN</option>
              <option>IN_PROGRESS</option>
              <option>RESOLVED</option>
              <option>CLOSED</option>
            </select>
          </label>
          <label>
            Severity
            <select
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option>LOW</option>
              <option>MEDIUM</option>
              <option>HIGH</option>
              <option>CRITICAL</option>
            </select>
          </label>
          <label>
            Impact
            <select
              value={blocking}
              onChange={(e) => {
                setBlocking(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="true">Blocking</option>
              <option value="false">Non-blocking</option>
            </select>
          </label>
        </div>
        {loading ? (
          <p className="muted">Loading issues…</p>
        ) : issues.length === 0 ? (
          <p className="empty-state">No issues match these filters.</p>
        ) : (
          <div className="issue-list">
            {issues.map((issue) => (
              <button
                className="issue-row"
                key={issue.id}
                onClick={() => void loadDetail(issue.id)}
              >
                <span>
                  <strong>{issue.questionLabel}</strong>
                  <small>
                    {issue.vehicleRegistration ?? "Vehicle"} · {issue.templateName ?? "Inspection"}
                  </small>
                </span>
                <span className="issue-badges">
                  {issue.isVehicleBlocking ? (
                    <b className="blocking">BLOCKING</b>
                  ) : (
                    <b>NON-BLOCKING</b>
                  )}
                  <b className={`severity severity-${issue.severity.toLowerCase()}`}>
                    {issue.severity}
                  </b>
                  <b className={`status status-${issue.status.toLowerCase()}`}>{issue.status}</b>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="pagination">
          <button disabled={page === 1 || loading} onClick={() => setPage((value) => value - 1)}>
            Previous
          </button>
          <span>Page {page}</span>
          <button disabled={!hasNextPage || loading} onClick={() => setPage((value) => value + 1)}>
            Next
          </button>
        </div>
      </section>
      {detail ? (
        <IssueDetail
          detail={detail}
          capabilities={capabilities}
          busy={busy}
          onClose={() => setDetail(null)}
          onProgress={() =>
            void mutate(
              `${base}/issues/${detail.issue.id}/progress`,
              {},
              "Issue moved to in progress.",
            )
          }
          onCloseIssue={() =>
            void mutate(`${base}/issues/${detail.issue.id}/close`, {}, "Issue closed.")
          }
          onAction={addAction}
          onResolve={resolve}
          onRelease={release}
        />
      ) : null}
    </main>
  );
}

function IssueDetail({
  detail,
  capabilities,
  busy,
  onClose,
  onProgress,
  onCloseIssue,
  onAction,
  onResolve,
  onRelease,
}: Readonly<{
  detail: Detail;
  capabilities: Capabilities;
  busy: boolean;
  onClose(): void;
  onProgress(): void;
  onCloseIssue(): void;
  onAction(event: FormEvent<HTMLFormElement>): void;
  onResolve(event: FormEvent<HTMLFormElement>): void;
  onRelease(event: FormEvent<HTMLFormElement>): void;
}>) {
  const issue = detail.issue;
  const activeHold = detail.holds.some((hold) => hold.isActive);
  return (
    <section className="panel issue-detail">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Issue detail</p>
          <h2>{issue.questionLabel}</h2>
          <p className="muted">
            {detail.vehicle.registrationDisplay} · {issue.templateName}
          </p>
        </div>
        <button className="quiet" onClick={onClose}>
          Close detail
        </button>
      </div>
      <div className="provenance">
        <span>
          <small>Status</small>
          <strong>{issue.status}</strong>
        </span>
        <span>
          <small>Severity</small>
          <strong>{issue.severity}</strong>
        </span>
        <span>
          <small>Impact</small>
          <strong>{issue.isVehicleBlocking ? "VEHICLE BLOCKING" : "NON-BLOCKING"}</strong>
        </span>
        <span>
          <small>Vehicle state</small>
          <strong>{detail.vehicle.operationalStatus}</strong>
        </span>
      </div>
      <p className="muted">
        Created {new Date(issue.createdAt).toLocaleString()} · Inspection{" "}
        {issue.inspectionSubmissionId.slice(0, 8)} · Response{" "}
        {issue.inspectionResponseId.slice(0, 8)}
      </p>
      {capabilities.canManage && issue.status === "OPEN" ? (
        <button disabled={busy} onClick={onProgress}>
          Start work
        </button>
      ) : null}
      <div className="detail-columns">
        <div>
          <h3>Actions / repairs</h3>
          {detail.actions.length ? (
            <ol className="timeline">
              {detail.actions.map((action) => (
                <li key={action.id}>
                  <strong>
                    {action.actionType}: {action.description}
                  </strong>
                  <small>{new Date(action.occurredAt).toLocaleString()}</small>
                  {action.notes ? <p>{action.notes}</p> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No repair actions recorded.</p>
          )}
          {capabilities.canManage && ["OPEN", "IN_PROGRESS"].includes(issue.status) ? (
            <form className="stack-form" onSubmit={(e) => void onAction(e)}>
              <select name="actionType" required>
                <option value="REPAIR">Repair</option>
                <option value="INSPECTION">Inspection</option>
                <option value="OTHER">Other</option>
              </select>
              <input name="description" required maxLength={2000} placeholder="Work performed" />
              <textarea name="notes" maxLength={2000} placeholder="Operational notes (optional)" />
              <button disabled={busy}>Record action</button>
            </form>
          ) : null}
        </div>
        <div>
          <h3>Status history</h3>
          <ol className="timeline">
            {detail.history.map((item) => (
              <li key={item.id}>
                <strong>
                  {item.fromStatus ? `${item.fromStatus} → ` : ""}
                  {item.toStatus}
                </strong>
                <small>{new Date(item.occurredAt).toLocaleString()}</small>
                {item.reason ? <p>{item.reason}</p> : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
      {issue.resolutionNotes ? (
        <div className="resolution-note">
          <strong>Resolution</strong>
          <p>{issue.resolutionNotes}</p>
          <small>{issue.resolvedAt ? new Date(issue.resolvedAt).toLocaleString() : null}</small>
        </div>
      ) : null}
      {capabilities.canResolve && ["OPEN", "IN_PROGRESS"].includes(issue.status) ? (
        <form className="stack-form decision-form" onSubmit={(e) => void onResolve(e)}>
          <h3>Resolve issue</h3>
          <textarea
            name="resolutionNotes"
            required
            maxLength={2000}
            placeholder="Resolution summary"
          />
          <button className="primary" disabled={busy}>
            Resolve issue
          </button>
          <small>Resolution does not release the vehicle.</small>
        </form>
      ) : null}
      {capabilities.canManage && issue.status === "RESOLVED" ? (
        <button disabled={busy} onClick={onCloseIssue}>
          Close issue
        </button>
      ) : null}
      {issue.isVehicleBlocking ? (
        <form className="stack-form release-form" onSubmit={(e) => void onRelease(e)}>
          <h3>Vehicle release</h3>
          <p>
            {activeHold
              ? "This vehicle has an active defect hold."
              : "This issue no longer has an active defect hold."}{" "}
            Release is checked against every unresolved blocking issue and the vehicle’s OOS
            provenance.
          </p>
          <input
            name="reason"
            required
            maxLength={2000}
            placeholder="Release reason / safety confirmation"
          />
          <button disabled={busy || !capabilities.canReleaseVehicle || !activeHold}>
            Release vehicle
          </button>
          {!capabilities.canReleaseVehicle ? (
            <small>You do not have vehicle release authority.</small>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
