/** Track A -- one HTTP mapping for coordinator outcomes, shared by the Platform Admin and coordinator routes. */
import { NextResponse } from 'next/server';
import type { CoordinatorError, InviteCoordinatorOutcome } from '@/services/institution-admin.service';

export function coordinatorInviteResponse(result: InviteCoordinatorOutcome): NextResponse {
  const created = result.outcome === 'INVITED' || result.outcome === 'ASSIGNED_EXISTING';
  return NextResponse.json({ success: true, data: result }, { status: created ? 201 : 200 });
}

export function coordinatorErrorResponse(error: CoordinatorError): NextResponse {
  switch (error.code) {
    case 'NOT_FOUND':
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    case 'INSTITUTION_NOT_AVAILABLE':
      return NextResponse.json({ error: 'INSTITUTION_NOT_AVAILABLE' }, { status: 409 });
    case 'ROLE_REVOKED':
      return NextResponse.json({ error: 'ROLE_REVOKED' }, { status: 409 });
    case 'LAST_COORDINATOR':
    case 'CANNOT_REMOVE_SELF':
      return NextResponse.json({ error: error.code }, { status: 409 });
  }
}
