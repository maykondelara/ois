"use client";
/* eslint-disable no-unused-vars, react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";

type Vehicle = { id: string; registration: string; registrationDisplay?: string };
type Template = { id: string; name: string };
type Version = { id: string; templateId: string; version: number };
type Question = {
  id: string;
  sectionId: string;
  label: string;
  helpText: string | null;
  isRequired: boolean;
  responseType: string;
  sortOrder: number;
};
type Option = { id: string; questionId: string; label: string; sortOrder: number };
type Section = { id: string; title: string; description: string | null; sortOrder: number };
type Submission = {
  id: string;
  templateId: string;
  templateVersionId: string;
  status: string;
  outcome: string | null;
  vehicleRegistration: string | null;
  templateName: string | null;
  startedAt: string;
};
type Answer = {
  booleanValue?: boolean;
  textValue?: string;
  numberValue?: number;
  odometerValueKm?: number;
  optionIds?: string[];
  comment?: string;
};

type FetchOptions = NonNullable<Parameters<typeof fetch>[1]>;

async function json<T>(url: string, init?: FetchOptions): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body;
}

const mutation = (method: string, body?: unknown): FetchOptions => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export default function InspectionWorkspace({ companyId }: Readonly<{ companyId: string }>) {
  const base = `/api/companies/${companyId}`;
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [available, setAvailable] = useState<Array<{ template: Template; version: Version }>>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [savedResponses, setSavedResponses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refreshHistory = useCallback(async () => {
    const result = await json<{ data: Submission[] }>(
      `${base}/inspections/submissions?pageSize=20`,
    );
    setSubmissions(result.data);
  }, [base]);

  useEffect(() => {
    void Promise.all([
      json<{ data: Vehicle[] }>(`${base}/vehicles?pageSize=100`).then((result) => {
        setVehicles(result.data);
        setVehicleId((current) => current || result.data[0]?.id || "");
      }),
      refreshHistory(),
    ]).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Unable to load inspections"),
    );
  }, [base, refreshHistory]);

  useEffect(() => {
    if (!vehicleId) return setAvailable([]);
    void json<{ data: Array<{ template: Template; version: Version }> }>(
      `${base}/inspections/applicable?vehicleId=${vehicleId}`,
    )
      .then((result) => setAvailable(result.data))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Unable to load templates"),
      );
  }, [base, vehicleId]);

  const grouped = useMemo(
    () =>
      sections.map((section) => ({
        section,
        questions: questions.filter((question) => question.sectionId === section.id),
      })),
    [questions, sections],
  );

  async function start(template: Template, version: Version) {
    setBusy(true);
    setError("");
    try {
      const created = await json<{ data: Submission }>(
        `${base}/inspections/submissions`,
        mutation("POST", { vehicleId, templateVersionId: version.id }),
      );
      const detail = await json<{
        data: { sections: Section[]; questions: Question[]; options: Option[] };
      }>(`${base}/inspections/templates/${template.id}?versionId=${version.id}`);
      setSubmission(created.data);
      setSections(detail.data.sections);
      setQuestions(detail.data.questions);
      setOptions(detail.data.options);
      setAnswers({});
      setSavedResponses({});
      setNotice("Inspection draft started.");
      await refreshHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to start inspection");
    } finally {
      setBusy(false);
    }
  }

  function setAnswer(questionId: string, update: Partial<Answer>) {
    setAnswers((current) => ({ ...current, [questionId]: { ...current[questionId], ...update } }));
  }

  async function save(question: Question) {
    if (!submission) return;
    setBusy(true);
    setError("");
    try {
      const result = await json<{ data: { id: string } }>(
        `${base}/inspections/submissions/${submission.id}/responses`,
        mutation("PUT", { questionId: question.id, ...answers[question.id] }),
      );
      setSavedResponses((current) => ({ ...current, [question.id]: result.data.id }));
      setNotice(`Saved “${question.label}”.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save response");
    } finally {
      setBusy(false);
    }
  }

  async function upload(question: Question, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const responseId = savedResponses[question.id];
    if (!file || !submission || !responseId) {
      setError("Save this response before attaching evidence.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const initiated = await json<{ data: { fileId: string; uploadUrl: string } }>(
        `${base}/files`,
        mutation("POST", { originalFilename: file.name }),
      );
      const uploaded = await fetch(initiated.data.uploadUrl, { method: "PUT", body: file });
      if (!uploaded.ok) throw new Error("Evidence upload failed");
      await json(`${base}/files/${initiated.data.fileId}/finalize`, mutation("POST"));
      await json(
        `${base}/inspections/submissions/${submission.id}/responses/${responseId}/files`,
        mutation("POST", { storedFileId: initiated.data.fileId }),
      );
      setNotice(`Attached evidence to “${question.label}”.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to attach evidence");
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  async function finish() {
    if (!submission) return;
    setBusy(true);
    setError("");
    try {
      const result = await json<{ data: { kind: string; outcome?: string } }>(
        `${base}/inspections/submissions/${submission.id}/submit`,
        mutation("POST", {}),
      );
      if (result.data.kind !== "SUBMITTED") {
        setError("The odometer reading needs confirmation in the full operational workflow.");
        return;
      }
      setNotice(`Inspection submitted: ${result.data.outcome}.`);
      setSubmission(null);
      await refreshHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit inspection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="inspection-shell">
      <header className="inspection-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Vehicle inspections</h1>
        </div>
        <span className="company-chip">Company {companyId.slice(0, 8)}</span>
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

      {!submission ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">New run</p>
              <h2>Choose a vehicle and checklist</h2>
            </div>
          </div>
          <label>
            Vehicle
            <select value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
              <option value="">Select a vehicle</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.registrationDisplay ?? vehicle.registration}
                </option>
              ))}
            </select>
          </label>
          <div className="template-grid">
            {available.map(({ template, version }) => (
              <article className="template-card" key={version.id}>
                <div>
                  <h3>{template.name}</h3>
                  <p>Published version {version.version}</p>
                </div>
                <button disabled={busy} onClick={() => void start(template, version)}>
                  Start inspection
                </button>
              </article>
            ))}
            {vehicleId && available.length === 0 ? (
              <p className="muted">No published inspections apply to this vehicle.</p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Draft inspection</p>
              <h2>{submission.templateName}</h2>
              <p className="muted">{submission.vehicleRegistration}</p>
            </div>
            <button className="primary" disabled={busy} onClick={() => void finish()}>
              Submit inspection
            </button>
          </div>
          {grouped.map(({ section, questions: sectionQuestions }) => (
            <fieldset key={section.id}>
              <legend>{section.title}</legend>
              {section.description ? <p className="muted">{section.description}</p> : null}
              {sectionQuestions.map((question) => (
                <QuestionField
                  key={question.id}
                  question={question}
                  options={options.filter((option) => option.questionId === question.id)}
                  answer={answers[question.id] ?? {}}
                  disabled={busy}
                  saved={Boolean(savedResponses[question.id])}
                  onChange={(update) => setAnswer(question.id, update)}
                  onSave={() => void save(question)}
                  onUpload={(event) => void upload(question, event)}
                />
              ))}
            </fieldset>
          ))}
        </section>
      )}

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2>Inspection history</h2>
          </div>
          <button className="quiet" onClick={() => void refreshHistory()}>
            Refresh
          </button>
        </div>
        <div className="history-list">
          {submissions.map((item) => (
            <article key={item.id}>
              <div>
                <strong>{item.templateName}</strong>
                <p>
                  {item.vehicleRegistration} · {new Date(item.startedAt).toLocaleString()}
                </p>
              </div>
              <span className={`status status-${item.status.toLowerCase()}`}>
                {item.outcome ?? item.status}
              </span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function QuestionField({
  question,
  options,
  answer,
  disabled,
  saved,
  onChange,
  onSave,
  onUpload,
}: Readonly<{
  question: Question;
  options: Option[];
  answer: Answer;
  disabled: boolean;
  saved: boolean;
  onChange(update: Partial<Answer>): void;
  onSave(): void;
  onUpload(event: ChangeEvent<HTMLInputElement>): void;
}>) {
  const type = question.responseType;
  return (
    <div className="question">
      <label>
        <span>
          {question.label}
          {question.isRequired ? " *" : ""}
        </span>
        {question.helpText ? <small>{question.helpText}</small> : null}
        {["YES_NO", "PASS_FAIL", "CHECKBOX"].includes(type) ? (
          <select
            value={answer.booleanValue === undefined ? "" : String(answer.booleanValue)}
            onChange={(event) => onChange({ booleanValue: event.target.value === "true" })}
          >
            <option value="">Select</option>
            <option value="true">{type === "PASS_FAIL" ? "Pass" : "Yes"}</option>
            <option value="false">{type === "PASS_FAIL" ? "Fail" : "No"}</option>
          </select>
        ) : null}
        {type === "TEXT" || type === "SIGNATURE" ? (
          <textarea
            value={answer.textValue ?? ""}
            onChange={(event) => onChange({ textValue: event.target.value })}
          />
        ) : null}
        {type === "NUMBER" ? (
          <input
            type="number"
            value={answer.numberValue ?? ""}
            onChange={(event) => onChange({ numberValue: event.target.valueAsNumber })}
          />
        ) : null}
        {type === "ODOMETER" ? (
          <input
            type="number"
            min="0"
            value={answer.odometerValueKm ?? ""}
            onChange={(event) => onChange({ odometerValueKm: event.target.valueAsNumber })}
          />
        ) : null}
        {type === "SINGLE_CHOICE" ? (
          <select
            value={answer.optionIds?.[0] ?? ""}
            onChange={(event) =>
              onChange({ optionIds: event.target.value ? [event.target.value] : [] })
            }
          >
            <option value="">Select</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}
        {type === "MULTI_CHOICE" ? (
          <div className="choices">
            {options.map((option) => (
              <label key={option.id}>
                <input
                  type="checkbox"
                  checked={answer.optionIds?.includes(option.id) ?? false}
                  onChange={(event) =>
                    onChange({
                      optionIds: event.target.checked
                        ? [...(answer.optionIds ?? []), option.id]
                        : (answer.optionIds ?? []).filter((id) => id !== option.id),
                    })
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
        ) : null}
        {type === "PHOTO" ? (
          <span className="muted">Save the response, then attach a photo below.</span>
        ) : null}
        <textarea
          className="comment"
          placeholder="Comment (when required or useful)"
          value={answer.comment ?? ""}
          onChange={(event) => onChange({ comment: event.target.value })}
        />
      </label>
      <div className="question-actions">
        <button disabled={disabled} onClick={onSave}>
          {saved ? "Save changes" : "Save response"}
        </button>
        <label className={saved ? "file-button" : "file-button disabled"}>
          Attach evidence
          <input
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            disabled={!saved || disabled}
            onChange={onUpload}
          />
        </label>
      </div>
    </div>
  );
}
