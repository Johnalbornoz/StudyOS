/**
 * Blueprint Engine V2 / BP-3 -- shadow parity report over every configuration
 * the catalogue applies (80 V2 + 8 V1 DEV-cert). DB-less: no connection is
 * opened, nothing is written. Prints the aggregate (and, with --records, the
 * debug-safe shadow records).
 *
 *   npx tsx --tsconfig tsconfig.json scripts/operations/blueprint-v2-shadow-parity.ts [--records]
 */
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { DEV_CERT_VERTICALS } from '@/lib/exam-core/verticals';
import { runShadowParity } from '@/lib/exam-core/blueprint-v2/shadow-parity';

const report = runShadowParity([...allV2Configs(), ...DEV_CERT_VERTICALS]);
const { records, ...summary } = report;
console.log(JSON.stringify({ ...summary, records: process.argv.includes('--records') ? records : records.length }, null, 2));
