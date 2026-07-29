export type VercelHttpOperation =
  | "GET_PROJECT"
  | "CREATE_PROJECT"
  | "CREATE_DEPLOYMENT"
  | "GET_DEPLOYMENT"
  | "GET_PROJECT_DOMAIN"
  | "ADD_PROJECT_DOMAIN"
  | "REQUEST_ROLLBACK";

export interface VercelHttpRequest {
  readonly operation: VercelHttpOperation;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface VercelHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * The transport is responsible for Vercel authentication and network policy.
 * Adapter requests deliberately contain no Authorization header or credential.
 */
export interface VercelHttpTransport {
  request(request: VercelHttpRequest): Promise<VercelHttpResponse>;
}
