/** Track A -- one HTTP mapping for curriculum management / governance errors (never leaks other tenants: foreign ids are 404). */
import { NextResponse } from 'next/server';
import { CurriculumManagementError } from './curriculum-management.service';
import { InstitutionOpsError } from './institution-operations.service';
import { GovernanceError } from './institution-governance.service';
import { FieldLockedError } from './academic-governance';
import { InvalidClassAssignmentError, NoLearnersToAssignError } from '@/lib/teacher/class-assignment.service';

const OPS_CONFLICT = new Set(['DUPLICATE_GRADE_NAME', 'DUPLICATE_CLASS_NAME', 'ALREADY_MEMBER', 'ALREADY_ENROLLED', 'INVALID_STATE', 'CLASS_ARCHIVED', 'GRADE_HAS_ACTIVE_CLASSES', 'GRADE_HAS_DEPENDENCIES', 'GRADE_NOT_ACTIVE', 'NOT_ENROLLED']);

export function governedError(error: unknown): NextResponse {
  if (error instanceof InstitutionOpsError) {
    // another institution's grade / class / teacher / curriculum / student is NOT_FOUND (never leaks)
    const status = error.code === 'NOT_FOUND' || error.code === 'TEACHER_NOT_AVAILABLE' || error.code === 'CURRICULUM_NOT_AVAILABLE' ? 404 : OPS_CONFLICT.has(error.code) ? 409 : 422;
    return NextResponse.json({ error: error.code }, { status });
  }
  if (error instanceof FieldLockedError) return NextResponse.json({ error: error.code, fields: error.fields }, { status: 403 });
  if (error instanceof CurriculumManagementError) {
    const status = error.code === 'NOT_FOUND' || error.code === 'CLASS_NOT_IN_INSTITUTION' ? 404 : error.code === 'CURRICULUM_NOT_ACTIVE' || error.code === 'IMPACT_CONFIRMATION_REQUIRED' ? 409 : 422;
    return NextResponse.json({ error: error.code }, { status });
  }
  if (error instanceof GovernanceError) {
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'NOT_ALLOWED' ? 403 : error.code === 'DIRECT_DELIVERY' ? 409 : 422;
    return NextResponse.json({ error: error.code }, { status });
  }
  if (error instanceof InvalidClassAssignmentError) return NextResponse.json({ error: error.code }, { status: error.code === 'FIELD_LOCKED_BY_INSTITUTION' ? 403 : 422 });
  if (error instanceof NoLearnersToAssignError) return NextResponse.json({ error: 'NO_LEARNERS_TO_ASSIGN' }, { status: 422 });
  throw error;
}
