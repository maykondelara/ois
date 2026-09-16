"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Vehicle = {
  id: string;
  registrationDisplay: string;
  operationalStatus: "ACTIVE" | "INACTIVE" | "OUT_OF_SERVICE";
  vehicleCategoryId: string;
  registrationExpiresOn: string | null;
  nextServiceOdometerKm: number | null;
  authoritativeOdometerKm?: number | null;
  kilometresRemaining?: number | null;
  latestAcceptedReading?: { readingKm: number; source: string; acceptedAt: string | null } | null;
};
type Category = { id: string; name: string; code: string; requiredLicenceClass: string | null };
type History = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  source: string;
  occurredAt: string;
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
const optionalNumber = (value: string | File | null) =>
  value === null || value === "" ? undefined : Number(value);
const nullableNumber = (value: string | File | null) =>
  value === null || value === "" ? null : Number(value);

export default function VehiclesWorkspace({ companyId }: Readonly<{ companyId: string }>) {
  const base = `/api/companies/${companyId}`;
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (q.trim()) query.set("q", q.trim());
      if (status) query.set("status", status);
      if (categoryId) query.set("vehicleCategoryId", categoryId);
      const result = await json<{
        data: Vehicle[];
        capabilities: { canManage: boolean };
        page: { hasNextPage: boolean };
      }>(`${base}/vehicles?${query}`);
      setVehicles(result.data);
      setCanManage(result.capabilities.canManage);
      setHasNextPage(result.page.hasNextPage);
    } finally {
      setLoading(false);
    }
  }, [base, categoryId, page, q, status]);

  const loadDetail = useCallback(
    async (vehicle: Vehicle) => {
      const [detail, statusHistory] = await Promise.all([
        json<{ data: Vehicle }>(`${base}/vehicles/${vehicle.id}`),
        json<{ data: History[] }>(`${base}/vehicles/${vehicle.id}/status-history`),
      ]);
      setSelected(detail.data);
      setHistory(statusHistory.data);
    },
    [base],
  );

  useEffect(() => {
    void Promise.all([
      loadList(),
      json<{ data: Category[] }>(`${base}/vehicle-categories`).then((result) =>
        setCategories(result.data),
      ),
    ]).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Unable to load vehicles"),
    );
  }, [base, loadList]);

  async function mutate(url: string, init: FetchOptions, message: string, reloadDetail = true) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await json(url, init);
      setNotice(message);
      await loadList();
      if (selected && reloadDetail) await loadDetail(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }

  async function createVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const operationalStatus = String(form.get("operationalStatus"));
    await mutate(
      `${base}/vehicles`,
      send("POST", {
        registration: form.get("registration"),
        vehicleCategoryId: form.get("vehicleCategoryId"),
        operationalStatus,
        statusReason:
          operationalStatus === "OUT_OF_SERVICE"
            ? form.get("statusReason") || undefined
            : undefined,
        initialOdometerKm: optionalNumber(form.get("initialOdometerKm")),
        nextServiceOdometerKm: optionalNumber(form.get("nextServiceOdometerKm")),
      }),
      "Vehicle created.",
      false,
    );
    event.currentTarget.reset();
  }

  return (
    <main className="operations-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Fleet</p>
          <h1>Vehicles</h1>
          <p className="page-intro">
            Manage fleet identity, service context and operational status.
          </p>
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
      <div className="workspace-columns">
        <section className="panel workspace-list">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Fleet register</p>
              <h2>Vehicle records</h2>
            </div>
            <button className="quiet" onClick={() => void loadList()}>
              Refresh
            </button>
          </div>
          <form
            className="filter-row compact"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              void loadList();
            }}
          >
            <label>
              Search
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Registration"
              />
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                <option>ACTIVE</option>
                <option>INACTIVE</option>
                <option>OUT_OF_SERVICE</option>
              </select>
            </label>
            <label>
              Category
              <select
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Search</button>
          </form>
          {loading ? (
            <p className="empty-state">Loading vehicles…</p>
          ) : vehicles.length ? (
            <div className="record-list">
              {vehicles.map((vehicle) => (
                <button
                  className={`record-row ${selected?.id === vehicle.id ? "selected" : ""}`}
                  key={vehicle.id}
                  onClick={() => void loadDetail(vehicle)}
                >
                  <span>
                    <strong>{vehicle.registrationDisplay}</strong>
                    <small>
                      {categories.find((item) => item.id === vehicle.vehicleCategoryId)?.name ??
                        "Vehicle category"}
                      {vehicle.nextServiceOdometerKm === null
                        ? ""
                        : ` · Service at ${vehicle.nextServiceOdometerKm.toLocaleString()} km`}
                    </small>
                  </span>
                  <b className={`status status-${vehicle.operationalStatus.toLowerCase()}`}>
                    {vehicle.operationalStatus.replaceAll("_", " ")}
                  </b>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-state">No vehicles match these filters.</p>
          )}
          <div className="pagination">
            <button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
              Previous
            </button>
            <span>Page {page}</span>
            <button disabled={!hasNextPage} onClick={() => setPage((value) => value + 1)}>
              Next
            </button>
          </div>
          {canManage ? (
            <form className="stack-form inset-form" onSubmit={createVehicle}>
              <h3>Add vehicle</h3>
              <div className="form-grid">
                <label>
                  Registration
                  <input name="registration" required />
                </label>
                <label>
                  Category
                  <select name="vehicleCategoryId" required>
                    <option value="">Choose category</option>
                    {categories.map((category) => (
                      <option value={category.id} key={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Initial odometer (km)
                  <input name="initialOdometerKm" type="number" min="0" />
                </label>
                <label>
                  Next service odometer (km)
                  <input name="nextServiceOdometerKm" type="number" min="0" />
                </label>
                <label>
                  Initial status
                  <select name="operationalStatus">
                    <option>ACTIVE</option>
                    <option>INACTIVE</option>
                    <option>OUT_OF_SERVICE</option>
                  </select>
                </label>
                <label>
                  Status reason (required for OOS)
                  <input name="statusReason" />
                </label>
              </div>
              <button className="primary" disabled={busy}>
                Create vehicle
              </button>
            </form>
          ) : null}
        </section>
        <section className="panel workspace-detail">
          {!selected ? (
            <div className="empty-state">
              <h2>Select a vehicle</h2>
              <p>Choose a record to view fleet details.</p>
            </div>
          ) : (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Vehicle detail</p>
                  <h2>{selected.registrationDisplay}</h2>
                </div>
                <b className={`status status-${selected.operationalStatus.toLowerCase()}`}>
                  {selected.operationalStatus.replaceAll("_", " ")}
                </b>
              </div>
              <dl className="detail-grid">
                <div>
                  <dt>Category</dt>
                  <dd>
                    {categories.find((item) => item.id === selected.vehicleCategoryId)?.name ??
                      "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Registration expiry</dt>
                  <dd>
                    {selected.registrationExpiresOn
                      ? new Date(selected.registrationExpiresOn).toLocaleDateString("en-AU")
                      : "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt>Latest accepted odometer</dt>
                  <dd>
                    {selected.authoritativeOdometerKm === null
                      ? "Not recorded"
                      : `${selected.authoritativeOdometerKm?.toLocaleString()} km`}
                  </dd>
                </div>
                <div>
                  <dt>Next service</dt>
                  <dd>
                    {selected.nextServiceOdometerKm === null
                      ? "Not scheduled"
                      : `${selected.nextServiceOdometerKm.toLocaleString()} km`}
                  </dd>
                </div>
                <div>
                  <dt>Distance to service</dt>
                  <dd>
                    {selected.kilometresRemaining === null
                      ? "Unavailable"
                      : `${selected.kilometresRemaining?.toLocaleString()} km`}
                  </dd>
                </div>
                <div>
                  <dt>Odometer provenance</dt>
                  <dd>
                    {selected.latestAcceptedReading?.source.replaceAll("_", " ") ??
                      "No accepted reading"}
                  </dd>
                </div>
              </dl>
              <p className="related-links">
                <a href={`/companies/${companyId}/inspections`}>View inspections</a>
                <a href={`/companies/${companyId}/issues?vehicleId=${selected.id}`}>
                  Related issues
                </a>
              </p>
              {canManage ? (
                <form
                  className="stack-form decision-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void mutate(
                      `${base}/vehicles/${selected.id}`,
                      send("PATCH", {
                        registration: form.get("registration"),
                        vehicleCategoryId: form.get("vehicleCategoryId"),
                        registrationExpiresOn: form.get("registrationExpiresOn") || null,
                      }),
                      "Vehicle details updated.",
                    );
                  }}
                >
                  <h3>Edit vehicle</h3>
                  <div className="form-grid">
                    <label>
                      Registration
                      <input
                        name="registration"
                        defaultValue={selected.registrationDisplay}
                        required
                      />
                    </label>
                    <label>
                      Category
                      <select name="vehicleCategoryId" defaultValue={selected.vehicleCategoryId}>
                        {categories.map((category) => (
                          <option value={category.id} key={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Registration expiry
                      <input
                        type="date"
                        name="registrationExpiresOn"
                        defaultValue={selected.registrationExpiresOn?.slice(0, 10) ?? ""}
                      />
                    </label>
                  </div>
                  <button disabled={busy}>Save vehicle</button>
                </form>
              ) : null}
              {canManage ? (
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void mutate(
                      `${base}/vehicles/${selected.id}/next-service-odometer`,
                      send("PUT", {
                        nextServiceOdometerKm: nullableNumber(form.get("nextServiceOdometerKm")),
                      }),
                      "Service odometer updated.",
                    );
                  }}
                >
                  <label>
                    Next service odometer (km)
                    <input
                      type="number"
                      min="0"
                      name="nextServiceOdometerKm"
                      defaultValue={selected.nextServiceOdometerKm ?? ""}
                    />
                  </label>
                  <button disabled={busy}>Update service schedule</button>
                </form>
              ) : null}
              {canManage ? (
                <form
                  className="stack-form decision-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void mutate(
                      `${base}/vehicles/${selected.id}/status`,
                      send("POST", {
                        status: form.get("status"),
                        reason: form.get("reason") || undefined,
                      }),
                      "Vehicle status updated.",
                    );
                  }}
                >
                  <h3>Change operational status</h3>
                  <p className="muted">
                    A reason is mandatory when placing a vehicle out of service or reactivating it.
                    Active defect holds cannot be bypassed here.
                  </p>
                  <div className="inline-form">
                    <label>
                      Status
                      <select name="status" defaultValue={selected.operationalStatus}>
                        <option>ACTIVE</option>
                        <option>INACTIVE</option>
                        <option>OUT_OF_SERVICE</option>
                      </select>
                    </label>
                    <label>
                      Reason
                      <input name="reason" placeholder="Operational reason" />
                    </label>
                    <button disabled={busy}>Update status</button>
                  </div>
                </form>
              ) : null}
              <div className="detail-section">
                <h3>Status history</h3>
                {history.length ? (
                  <ol className="timeline">
                    {history.map((entry) => (
                      <li key={entry.id}>
                        <strong>
                          {entry.fromStatus
                            ? `${entry.fromStatus.replaceAll("_", " ")} → `
                            : "Created as "}
                          {entry.toStatus.replaceAll("_", " ")}
                        </strong>
                        <small>
                          {new Date(entry.occurredAt).toLocaleString("en-AU")} ·{" "}
                          {entry.source.replaceAll("_", " ")}
                        </small>
                        {entry.reason ? <p>{entry.reason}</p> : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted">No status history recorded.</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
