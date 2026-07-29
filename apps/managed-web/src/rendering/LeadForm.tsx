"use client";

import { useRef, useState, type FormEvent } from "react";

import { emitManagedAnalyticsEvent } from "../analytics/managed-analytics";

type LeadField = "NAME" | "EMAIL" | "PHONE" | "MESSAGE";

export interface LeadFormProps {
  readonly analyticsEventName: string;
  readonly fields: readonly LeadField[];
  readonly moduleId: string;
}

export function LeadForm({
  analyticsEventName,
  fields,
  moduleId,
}: LeadFormProps) {
  const renderedAt = useRef(Date.now());
  const submissionId = useRef<string | undefined>(undefined);
  const [state, setState] = useState<"IDLE" | "SUBMITTING" | "SUCCESS" | "ERROR">(
    "IDLE",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("SUBMITTING");
    submissionId.current ??= crypto.randomUUID();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const submission: Record<string, string | number> = {
      submissionId: submissionId.current,
      honeypot: stringValue(form, "website"),
      renderedAt: renderedAt.current,
    };
    for (const field of fields) {
      submission[field.toLowerCase()] = stringValue(
        form,
        field.toLowerCase(),
      );
    }

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ moduleId, submission }),
      });
      if (!response.ok) {
        setState("ERROR");
        return;
      }

      setState("SUCCESS");
      submissionId.current = undefined;
      formElement.reset();
      emitManagedAnalyticsEvent(analyticsEventName);
    } catch {
      setState("ERROR");
    }
  }

  return (
    <form className="lead-form" onSubmit={submit}>
      <div className="lead-form-heading">
        <p className="site-eyebrow">Request a callback</p>
        <h2>Tell us how we can help</h2>
      </div>

      <div className="lead-form-fields">
        {fields.map(renderField)}
        <div aria-hidden="true" className="lead-form-honeypot">
          <label htmlFor={`${moduleId}-website`}>Website</label>
          <input
            autoComplete="off"
            id={`${moduleId}-website`}
            name="website"
            tabIndex={-1}
            type="text"
          />
        </div>
      </div>

      <button disabled={state === "SUBMITTING"} type="submit">
        {state === "SUBMITTING" ? "Sending..." : "Send enquiry"}
      </button>

      <p aria-live="polite" className="lead-form-status" role="status">
        {state === "SUCCESS"
          ? "Thanks. Your enquiry has been sent."
          : state === "ERROR"
            ? "We could not send your enquiry. Please try again."
            : ""}
      </p>
    </form>
  );

  function renderField(field: LeadField) {
    const name = field.toLowerCase();
    const id = `${moduleId}-${name}`;
    const label = fieldLabel(field);
    if (field === "MESSAGE") {
      return (
        <label className="lead-form-field lead-form-field-wide" key={field} htmlFor={id}>
          <span>{label}</span>
          <textarea id={id} name={name} required rows={5} />
        </label>
      );
    }

    return (
      <label className="lead-form-field" key={field} htmlFor={id}>
        <span>{label}</span>
        <input
          autoComplete={autocompleteFor(field)}
          id={id}
          name={name}
          required
          type={field === "EMAIL" ? "email" : field === "PHONE" ? "tel" : "text"}
        />
      </label>
    );
  }
}

function stringValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function fieldLabel(field: LeadField): string {
  switch (field) {
    case "NAME":
      return "Name";
    case "EMAIL":
      return "Email";
    case "PHONE":
      return "Phone";
    case "MESSAGE":
      return "How can we help?";
  }
}

function autocompleteFor(
  field: Exclude<LeadField, "MESSAGE">,
): "email" | "name" | "tel" {
  switch (field) {
    case "NAME":
      return "name";
    case "EMAIL":
      return "email";
    case "PHONE":
      return "tel";
  }
}
