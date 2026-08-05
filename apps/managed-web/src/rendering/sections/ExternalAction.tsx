import type { RuntimeExternalAction } from "../../runtime-types";

export function ExternalAction({ action }: { readonly action: RuntimeExternalAction }) {
  if (action.state === "CONFIGURED" && action.href !== undefined) {
    return (
      <a
        className="profile-action profile-action-configured"
        data-action-kind={action.kind}
        data-action-state={action.state}
        href={action.href}
      >
        {action.label}
      </a>
    );
  }

  return (
    <div
      className="profile-action profile-action-not-configured"
      data-action-kind={action.kind}
      data-action-state="NOT_CONFIGURED"
      role="status"
    >
      <strong>{action.label}</strong>
      <span>{action.message}</span>
    </div>
  );
}
