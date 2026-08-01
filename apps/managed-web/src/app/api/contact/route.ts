import { handleContactFormRequest } from "../../../server/contact-form-runtime";
import { createManagedContactRuntime } from "../../../server/managed-contact-runtime";

const runtime = createManagedContactRuntime();

export function POST(request: Request): Promise<Response> {
  return handleContactFormRequest(request, runtime);
}
