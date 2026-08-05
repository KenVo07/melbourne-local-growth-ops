"use client";

import { useRef, useState, type FormEvent } from "react";

import { emitManagedAnalyticsEvent } from "../analytics/managed-analytics";

type LeadField = "NAME" | "EMAIL" | "PHONE" | "MESSAGE";
type LeadFormState = "IDLE" | "SUBMITTING" | "SUCCESS" | "ERROR" | "INVALID";
type FieldErrors = Partial<Record<LeadField, string>>;

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
  const fieldElements = useRef<
    Partial<Record<LeadField, HTMLInputElement | HTMLTextAreaElement | undefined>>
  >({});
  const [state, setState] = useState<LeadFormState>("IDLE");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    const errors: FieldErrors = {};
    for (const field of fields) {
      const value = stringValue(form, field.toLowerCase());
      if (value.trim() === "") {
        errors[field] = `${fieldLabel(field)} is required.`;
      } else if (fieldElements.current[field]?.validity.typeMismatch === true) {
        errors[field] = `${fieldLabel(field)} must be a valid email address.`;
      }
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setState("INVALID");
      const firstInvalidField = fields.find((field) => errors[field] !== undefined);
      if (firstInvalidField !== undefined) {
        fieldElements.current[firstInvalidField]?.focus();
      }
      return;
    }

    setFieldErrors({});
    setState("SUBMITTING");
    submissionId.current ??= crypto.randomUUID();

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
    <form className="lead-form" noValidate onSubmit={submit}>
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
            : state === "INVALID"
              ? "Please fix the highlighted fields before sending."
              : ""}
      </p>
    </form>
  );

  function renderField(field: LeadField) {
    const name = field.toLowerCase();
    const id = `${moduleId}-${name}`;
    const errorId = `${id}-error`;
    const label = fieldLabel(field);
    const error = fieldErrors[field];

    if (field === "MESSAGE") {
      return (
        <label className="lead-form-field lead-form-field-wide" data-invalid={error !== undefined} key={field} htmlFor={id}>
          <span>{label}</span>
          <textarea
            aria-describedby={error === undefined ? undefined : errorId}
            aria-invalid={error === undefined ? undefined : "true"}
            id={id}
            name={name}
            ref={(node) => {
              fieldElements.current[field] = node ?? undefined;
            }}
            required
            rows={5}
          />
          {error === undefined ? null : (
            <p className="lead-form-field-error" id={errorId}>
              {error}
            </p>
          )}
        </label>
      );
    }

    return (
      <label className="lead-form-field" data-invalid={error !== undefined} key={field} htmlFor={id}>
        <span>{label}</span>
        <input
          aria-describedby={error === undefined ? undefined : errorId}
          aria-invalid={error === undefined ? undefined : "true"}
          autoComplete={autocompleteFor(field)}
          id={id}
          name={name}
          ref={(node) => {
            fieldElements.current[field] = node ?? undefined;
          }}
          required
          type={field === "EMAIL" ? "email" : field === "PHONE" ? "tel" : "text"}
        />
        {error === undefined ? null : (
          <p className="lead-form-field-error" id={errorId}>
            {error}
          </p>
        )}
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
