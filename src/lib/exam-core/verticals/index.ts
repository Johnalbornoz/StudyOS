/**
 * Track B -- the DEV certification catalog: one configuration per vertical
 * (two for IB and AICE, to prove multi-subject configuration). Every entry is
 * `contentStatus: 'DEV_CERT_FIXTURE'`. Applied only by an explicit operator
 * action (scripts/operations/track-b-apply-verticals.ts or the admin API),
 * never at build or start.
 */
import type { ExamFamily } from '../taxonomy';
import type { ExamVerticalConfigInput } from '../vertical-config';
import { PAA_DEV_CERT } from './paa';
import { PISA_DEV_CERT } from './pisa';
import { IB_MATH_AA_SL_DEV_CERT, IB_BIOLOGY_HL_DEV_CERT } from './ib';
import { CAMBRIDGE_IGCSE_MATH_DEV_CERT, AICE_AS_MATH_DEV_CERT, AICE_AS_EGP_DEV_CERT } from './cambridge';
import { ICFES_DEV_CERT } from './icfes';

export const DEV_CERT_VERTICALS: ExamVerticalConfigInput[] = [
  PAA_DEV_CERT,
  PISA_DEV_CERT,
  IB_MATH_AA_SL_DEV_CERT,
  IB_BIOLOGY_HL_DEV_CERT,
  CAMBRIDGE_IGCSE_MATH_DEV_CERT,
  AICE_AS_MATH_DEV_CERT,
  AICE_AS_EGP_DEV_CERT,
  ICFES_DEV_CERT,
];

/** The configuration each vertical's end-to-end certification path runs. */
export const PRIMARY_DEV_CERT_BY_FAMILY: Record<ExamFamily, ExamVerticalConfigInput> = {
  PAA: PAA_DEV_CERT,
  PISA: PISA_DEV_CERT,
  IB: IB_MATH_AA_SL_DEV_CERT,
  CAMBRIDGE: CAMBRIDGE_IGCSE_MATH_DEV_CERT,
  AICE: AICE_AS_MATH_DEV_CERT,
  ICFES: ICFES_DEV_CERT,
};
