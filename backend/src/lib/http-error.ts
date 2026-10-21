export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have permission for this action') => new HttpError(403, 'FORBIDDEN', msg);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', msg, details);
export const conflict = (msg: string) => new HttpError(409, 'CONFLICT', msg);
export const limitReached = (msg: string) => new HttpError(402, 'PLAN_LIMIT_REACHED', msg);
