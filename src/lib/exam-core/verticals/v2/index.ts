export { IB_MATH_AA_HL_V2 } from './ib-math-aa-hl';
export { IB_VISUAL_ARTS_SL_V2, IB_VISUAL_ARTS_HL_V2 } from './ib-visual-arts';
export { PISA_MATH_V2 } from './pisa-math';
export { SABER11_MATH_V2 } from './saber11-math';
export { PAA_MATH_V2 } from './paa-math';
export { PAA_V2 } from './paa';
export { CAMBRIDGE_0580_EXTENDED_V2 } from './cambridge-0580';
export { IB_PHYSICS_SL_V2, IB_PHYSICS_HL_V2 } from './ib-physics';
export { IB_CHEMISTRY_SL_V2, IB_CHEMISTRY_HL_V2 } from './ib-chemistry';
export { IB_BIOLOGY_SL_V2, IB_BIOLOGY_HL_V2 } from './ib-biology';
export { IB_MATH_AA_SL_V2, IB_MATH_AI_SL_V2, IB_MATH_AI_HL_V2 } from './ib-math-more';

import type { ExamVerticalConfigInput } from '../../vertical-config';
import { IB_MATH_AA_HL_V2 } from './ib-math-aa-hl';
import { IB_VISUAL_ARTS_SL_V2, IB_VISUAL_ARTS_HL_V2 } from './ib-visual-arts';
import { PISA_MATH_V2 } from './pisa-math';
import { SABER11_MATH_V2 } from './saber11-math';
import { PAA_V2 } from './paa';
import { CAMBRIDGE_0580_EXTENDED_V2 } from './cambridge-0580';
import { IB_PHYSICS_SL_V2, IB_PHYSICS_HL_V2 } from './ib-physics';
import { IB_CHEMISTRY_SL_V2, IB_CHEMISTRY_HL_V2 } from './ib-chemistry';
import { IB_BIOLOGY_SL_V2, IB_BIOLOGY_HL_V2 } from './ib-biology';
import { IB_MATH_AA_SL_V2, IB_MATH_AI_SL_V2, IB_MATH_AI_HL_V2 } from './ib-math-more';

/** The V2 reference verticals (applied by an explicit operator action only). */
/** Superseded configurations: retired (definition status RETIRED) by the V2 apply script, never deleted. */
export const RETIRED_V2_CONFIG_KEYS = ['v2.paa.math'];

export const V2_VERTICALS: ExamVerticalConfigInput[] = [IB_MATH_AA_HL_V2, IB_VISUAL_ARTS_SL_V2, IB_VISUAL_ARTS_HL_V2, PISA_MATH_V2, SABER11_MATH_V2, PAA_V2, CAMBRIDGE_0580_EXTENDED_V2,
  IB_MATH_AA_SL_V2, IB_MATH_AI_SL_V2, IB_MATH_AI_HL_V2, IB_PHYSICS_SL_V2, IB_PHYSICS_HL_V2, IB_CHEMISTRY_SL_V2, IB_CHEMISTRY_HL_V2, IB_BIOLOGY_SL_V2, IB_BIOLOGY_HL_V2];

