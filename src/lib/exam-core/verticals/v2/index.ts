export { IB_MATH_AA_HL_V2 } from './ib-math-aa-hl';
export { IB_VISUAL_ARTS_SL_V2, IB_VISUAL_ARTS_HL_V2 } from './ib-visual-arts';
export { PISA_MATH_V2 } from './pisa-math';
export { SABER11_MATH_V2 } from './saber11-math';
export { PAA_MATH_V2 } from './paa-math';
export { CAMBRIDGE_0580_EXTENDED_V2 } from './cambridge-0580';

import type { ExamVerticalConfigInput } from '../../vertical-config';
import { IB_MATH_AA_HL_V2 } from './ib-math-aa-hl';
import { IB_VISUAL_ARTS_SL_V2, IB_VISUAL_ARTS_HL_V2 } from './ib-visual-arts';
import { PISA_MATH_V2 } from './pisa-math';
import { SABER11_MATH_V2 } from './saber11-math';
import { PAA_MATH_V2 } from './paa-math';
import { CAMBRIDGE_0580_EXTENDED_V2 } from './cambridge-0580';

/** The V2 reference verticals (applied by an explicit operator action only). */
export const V2_VERTICALS: ExamVerticalConfigInput[] = [IB_MATH_AA_HL_V2, IB_VISUAL_ARTS_SL_V2, IB_VISUAL_ARTS_HL_V2, PISA_MATH_V2, SABER11_MATH_V2, PAA_MATH_V2, CAMBRIDGE_0580_EXTENDED_V2];
