/** Exam V2 -- shared error mapping for the submission routes. */
import { NextResponse } from 'next/server';
import { SubmissionError } from './submission.service';
import { MediaError } from '../media/media.service';

export function submissionErrorResponse(err: unknown): NextResponse {
  if (err instanceof SubmissionError) {
    const status = err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN' ? 404 : err.code === 'ITEM_NOT_OPEN' || err.code === 'SUBMISSION_LOCKED' ? 409 : 422;
    return NextResponse.json({ error: err.code === 'FORBIDDEN' ? 'NOT_FOUND' : err.code, detail: err.message.split(': ')[1] }, { status });
  }
  if (err instanceof MediaError) {
    const status = err.code === 'BAD_SIGNATURE' || err.code === 'EXPIRED' ? 403 : err.code === 'REJECTED' ? 422 : err.code === 'NO_SIGNING_SECRET' ? 500 : 404;
    return NextResponse.json({ error: err.code }, { status });
  }
  throw err;
}

export function parseIndex(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10000 ? n : null;
}
