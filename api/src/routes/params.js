import { AppError } from '../util/errors.js';

export function idParam(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new AppError('VALIDATION', `잘못된 id: ${v}`, 400);
  return n;
}
