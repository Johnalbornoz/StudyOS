/** Exam eligibility -- one HTTP mapping for class exam assignment errors (foreign ids are 404, never a hint). */
import { NextResponse } from 'next/server';
import { examAssignmentErrorStatus, ExamAssignmentError } from './class-exam-assignment.service';

export function examAssignmentError(error: unknown): NextResponse {
  if (error instanceof ExamAssignmentError) return NextResponse.json({ error: error.code }, { status: examAssignmentErrorStatus(error.code) });
  throw error;
}
