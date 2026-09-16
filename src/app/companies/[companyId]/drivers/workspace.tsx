"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Driver = {
  id: string;
  displayName: string;
  phoneE164: string | null;
  operationalStatus: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "ON_LEAVE";
  linkedUser: boolean;
  emergencyContactName: string | null;
  emergencyContactPhoneE164: string | null;
};
type Licence = {
  id: string;
  licenceType: string;
  issuingJurisdiction: string | null;
  licenceNumberLast4: string;
  issuedOn: string | null;
  expiresOn: string;
};
type Availability = { dayOfWeek: number; isAvailable: boolean };
type Capability = {
  id: string;
  vehicleCategoryId: string;
  isActive: boolean;
  expiresOn: string | null;
};
type Category = { id: string; name: string; code: string; requiredLicenceClass: string | null };
type FetchOptions = NonNullable<Parameters<typeof fetch>[1]>;
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
const dateValue = (value: string | File | null) => (value ? String(value) : null);

export default function DriversWorkspace({ companyId }: Readonly<{ companyId: string }>) {
  const base = `/api/companies/${companyId}`;
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selected, setSelected] = useState<Driver | null>(null);
  const [licences, setLicences] = useState<Licence[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
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
      const result = await json<{
        data: Driver[];
        capabilities: { canManage: boolean };
        page: { hasNextPage: boolean };
      }>(`${base}/drivers?${query}`);
      setDrivers(result.data);
      setCanManage(result.capabilities.canManage);
      setHasNextPage(result.page.hasNextPage);
    } finally {
      setLoading(false);
    }
  }, [base, page, q, status]);

  const loadDetail = useCallback(
    async (driver: Driver) => {
      const [detail, licenceResult, availabilityResult, capabilityResult] = await Promise.all([
        json<{ data: Driver }>(`${base}/drivers/${driver.id}`),
        json<{ data: Licence[] }>(`${base}/drivers/${driver.id}/licences`),
        json<{ data: Availability[] }>(`${base}/drivers/${driver.id}/availability`),
        json<{ data: Capability[] }>(`${base}/drivers/${driver.id}/vehicle-capabilities`),
      ]);
      setSelected(detail.data);
      setLicences(licenceResult.data);
      setAvailability(availabilityResult.data);
      setCapabilities(capabilityResult.data);
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
      setError(cause instanceof Error ? cause.message : "Unable to load drivers"),
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

  async function createDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate(
      `${base}/drivers`,
      send("POST", {
        displayName: form.get("displayName"),
        phoneE164: form.get("phoneE164") || undefined,
      }),
      "Driver created.",
      false,
    );
    event.currentTarget.reset();
  }

  return (
    <main className="operations-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">People</p>
          <h1>Drivers</h1>
          <p className="page-intro">
            Manage operational records, licences, availability and vehicle capability.
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
              <p className="eyebrow">Directory</p>
              <h2>Driver records</h2>
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
                placeholder="Name or phone"
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
                <option>SUSPENDED</option>
                <option>ON_LEAVE</option>
              </select>
            </label>
            <button type="submit">Search</button>
          </form>
          {loading ? (
            <p className="empty-state">Loading drivers…</p>
          ) : drivers.length ? (
            <div className="record-list">
              {drivers.map((driver) => (
                <button
                  className={`record-row ${selected?.id === driver.id ? "selected" : ""}`}
                  key={driver.id}
                  onClick={() => void loadDetail(driver)}
                >
                  <span>
                    <strong>{driver.displayName}</strong>
                    <small>
                      {driver.phoneE164 ?? "No phone"} ·{" "}
                      {driver.linkedUser ? "User linked" : "No user link"}
                    </small>
                  </span>
                  <b className={`status status-${driver.operationalStatus.toLowerCase()}`}>
                    {driver.operationalStatus.replaceAll("_", " ")}
                  </b>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-state">No drivers match these filters.</p>
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
            <form className="stack-form inset-form" onSubmit={createDriver}>
              <h3>Add driver</h3>
              <label>
                Display name
                <input name="displayName" required maxLength={200} />
              </label>
              <label>
                Phone (E.164)
                <input name="phoneE164" placeholder="+61400000000" />
              </label>
              <button className="primary" disabled={busy}>
                Create driver
              </button>
            </form>
          ) : null}
        </section>
        <section className="panel workspace-detail">
          {!selected ? (
            <div className="empty-state">
              <h2>Select a driver</h2>
              <p>Choose a record to view operational details.</p>
            </div>
          ) : (
            <>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Driver detail</p>
                  <h2>{selected.displayName}</h2>
                </div>
                <b className={`status status-${selected.operationalStatus.toLowerCase()}`}>
                  {selected.operationalStatus.replaceAll("_", " ")}
                </b>
              </div>
              <dl className="detail-grid">
                <div>
                  <dt>Phone</dt>
                  <dd>{selected.phoneE164 ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>User access</dt>
                  <dd>{selected.linkedUser ? "Linked" : "Not linked"}</dd>
                </div>
                <div>
                  <dt>Emergency contact</dt>
                  <dd>{selected.emergencyContactName ?? "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Emergency phone</dt>
                  <dd>{selected.emergencyContactPhoneE164 ?? "Not recorded"}</dd>
                </div>
              </dl>
              <p className="related-links">
                <a href={`/companies/${companyId}/inspections`}>View inspections</a>
                <a href={`/companies/${companyId}/issues`}>View issues</a>
              </p>
              {canManage ? (
                <form
                  className="stack-form decision-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void mutate(
                      `${base}/drivers/${selected.id}`,
                      send("PATCH", {
                        displayName: form.get("displayName"),
                        phoneE164: form.get("phoneE164") || undefined,
                        emergencyContactName: form.get("emergencyContactName") || null,
                        emergencyContactPhoneE164: form.get("emergencyContactPhoneE164") || null,
                      }),
                      "Driver details updated.",
                    );
                  }}
                >
                  <h3>Edit driver</h3>
                  <div className="form-grid">
                    <label>
                      Display name
                      <input name="displayName" defaultValue={selected.displayName} required />
                    </label>
                    <label>
                      Phone (E.164)
                      <input name="phoneE164" defaultValue={selected.phoneE164 ?? ""} />
                    </label>
                    <label>
                      Emergency contact
                      <input
                        name="emergencyContactName"
                        defaultValue={selected.emergencyContactName ?? ""}
                      />
                    </label>
                    <label>
                      Emergency phone (E.164)
                      <input
                        name="emergencyContactPhoneE164"
                        defaultValue={selected.emergencyContactPhoneE164 ?? ""}
                      />
                    </label>
                  </div>
                  <button disabled={busy}>Save driver</button>
                </form>
              ) : null}
              {canManage ? (
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void mutate(
                      `${base}/drivers/${selected.id}/status`,
                      send("POST", { status: form.get("status") }),
                      "Driver status updated.",
                    );
                  }}
                >
                  <label>
                    Operational status
                    <select name="status" defaultValue={selected.operationalStatus}>
                      <option>ACTIVE</option>
                      <option>INACTIVE</option>
                      <option>SUSPENDED</option>
                      <option>ON_LEAVE</option>
                    </select>
                  </label>
                  <button disabled={busy}>Update status</button>
                </form>
              ) : null}
              <div className="detail-section">
                <h3>Licences</h3>
                {licences.length ? (
                  <div className="summary-list">
                    {licences.map((licence) => (
                      <article key={licence.id}>
                        <strong>{licence.licenceType}</strong>
                        <span>•••• {licence.licenceNumberLast4}</span>
                        <small>
                          {licence.issuingJurisdiction ?? "Jurisdiction not recorded"} · Expires{" "}
                          {new Date(licence.expiresOn).toLocaleDateString("en-AU")}
                        </small>
                        {canManage ? (
                          <form
                            className="inline-form compact-edit"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const form = new FormData(event.currentTarget);
                              void mutate(
                                `${base}/drivers/${selected.id}/licences/${licence.id}`,
                                send("PATCH", {
                                  issuingJurisdiction: form.get("issuingJurisdiction") || null,
                                  expiresOn: form.get("expiresOn"),
                                }),
                                "Licence updated.",
                              );
                            }}
                          >
                            <label>
                              Jurisdiction
                              <input
                                name="issuingJurisdiction"
                                defaultValue={licence.issuingJurisdiction ?? ""}
                              />
                            </label>
                            <label>
                              Expires on
                              <input
                                type="date"
                                name="expiresOn"
                                defaultValue={licence.expiresOn.slice(0, 10)}
                                required
                              />
                            </label>
                            <button disabled={busy}>Update licence</button>
                          </form>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No licences recorded.</p>
                )}
                {canManage ? (
                  <form
                    className="stack-form inset-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void mutate(
                        `${base}/drivers/${selected.id}/licences`,
                        send("POST", {
                          licenceNumber: form.get("licenceNumber"),
                          licenceType: form.get("licenceType"),
                          issuingJurisdiction: form.get("issuingJurisdiction") || null,
                          issuedOn: dateValue(form.get("issuedOn")),
                          expiresOn: form.get("expiresOn"),
                        }),
                        "Licence added.",
                      );
                      event.currentTarget.reset();
                    }}
                  >
                    <h4>Add licence</h4>
                    <div className="form-grid">
                      <label>
                        Licence number
                        <input name="licenceNumber" required />
                      </label>
                      <label>
                        Licence type
                        <input name="licenceType" defaultValue="DRIVER_LICENCE" required />
                      </label>
                      <label>
                        Jurisdiction
                        <input name="issuingJurisdiction" />
                      </label>
                      <label>
                        Issued on
                        <input type="date" name="issuedOn" />
                      </label>
                      <label>
                        Expires on
                        <input type="date" name="expiresOn" required />
                      </label>
                    </div>
                    <button disabled={busy}>Add licence</button>
                  </form>
                ) : null}
              </div>
              <div className="detail-section">
                <h3>Regular availability</h3>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const entries = days.map((_, dayOfWeek) => ({
                      dayOfWeek,
                      isAvailable: form.get(`day-${dayOfWeek}`) === "on",
                    }));
                    void mutate(
                      `${base}/drivers/${selected.id}/availability`,
                      send("PUT", entries),
                      "Availability updated.",
                    );
                  }}
                >
                  <div className="check-grid">
                    {days.map((day, index) => (
                      <label key={day}>
                        <input
                          type="checkbox"
                          name={`day-${index}`}
                          defaultChecked={
                            availability.find((entry) => entry.dayOfWeek === index)?.isAvailable ??
                            false
                          }
                          disabled={!canManage}
                        />
                        {day}
                      </label>
                    ))}
                  </div>
                  {canManage ? <button disabled={busy}>Save availability</button> : null}
                </form>
              </div>
              <div className="detail-section">
                <h3>Vehicle capabilities</h3>
                {capabilities.length ? (
                  <div className="summary-list">
                    {capabilities.map((capability) => {
                      const category = categories.find(
                        (item) => item.id === capability.vehicleCategoryId,
                      );
                      return (
                        <article key={capability.id}>
                          <strong>{category?.name ?? "Vehicle category"}</strong>
                          <span>{capability.isActive ? "Active" : "Inactive"}</span>
                          <small>
                            {capability.expiresOn
                              ? `Expires ${new Date(capability.expiresOn).toLocaleDateString("en-AU")}`
                              : "No expiry"}
                          </small>
                          {canManage ? (
                            <button
                              className="quiet danger-text"
                              onClick={() =>
                                void mutate(
                                  `${base}/drivers/${selected.id}/vehicle-capabilities/${capability.vehicleCategoryId}`,
                                  { method: "DELETE" },
                                  "Capability removed.",
                                )
                              }
                            >
                              Remove
                            </button>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="muted">No vehicle capabilities recorded.</p>
                )}
                {canManage ? (
                  <form
                    className="inline-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void mutate(
                        `${base}/drivers/${selected.id}/vehicle-capabilities`,
                        send("POST", {
                          vehicleCategoryId: form.get("vehicleCategoryId"),
                          expiresOn: dateValue(form.get("expiresOn")),
                        }),
                        "Capability saved.",
                      );
                    }}
                  >
                    <label>
                      Category
                      <select name="vehicleCategoryId" required>
                        <option value="">Choose category</option>
                        {categories.map((category) => (
                          <option value={category.id} key={category.id}>
                            {category.name}
                            {category.requiredLicenceClass
                              ? ` (${category.requiredLicenceClass})`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Expires on
                      <input type="date" name="expiresOn" />
                    </label>
                    <button disabled={busy}>Add capability</button>
                  </form>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
