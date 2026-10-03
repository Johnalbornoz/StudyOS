/** Every configuration the catalogue binds to: hand-written (with banks) + generated IB structure-only ones. */
import type { ExamVerticalConfigInput } from '../../vertical-config';
import { V2_VERTICALS } from './index';
import { ibStructureConfigs } from '../../catalog/ib-dp';

export function allV2Configs(): ExamVerticalConfigInput[] {
  return [...V2_VERTICALS, ...ibStructureConfigs()];
}
