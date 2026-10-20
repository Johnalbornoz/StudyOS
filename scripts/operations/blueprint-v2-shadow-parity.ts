/**
 * Blueprint Engine V2 -- shadow parity report over every configuration the
 * catalogue applies (80 V2 + 8 V1 DEV-cert). DB-less: no connection is
 * opened, nothing is written.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/operations/blueprint-v2-shadow-parity.ts [--runtime] [--records]
 *
 *   (default)  BP-3 resolver parity
 *   --runtime  BP-4A: drives the REAL runtime hooks (formInputs / F9 plan) with an in-memory store
 *              reproducing the rows the apply service writes; metrics by flow, family, purpose, status
 */
import { allV2Configs } from '@/lib/exam-core/verticals/v2/all';
import { DEV_CERT_VERTICALS } from '@/lib/exam-core/verticals';
import { runShadowParity } from '@/lib/exam-core/blueprint-v2/shadow-parity';
import { runRuntimeShadowParity } from '@/lib/exam-core/blueprint-v2/shadow-catalog';

const configs = [...allV2Configs(), ...DEV_CERT_VERTICALS];
const withRecords = process.argv.includes('--records');

(async () => {
  if (process.argv.includes('--runtime')) {
    const { records, ...summary } = await runRuntimeShadowParity(configs);
    console.log(JSON.stringify({ ...summary, records: withRecords ? records : records.length }, null, 2));
    return;
  }
  const { records, ...summary } = runShadowParity(configs);
  console.log(JSON.stringify({ ...summary, records: withRecords ? records : records.length }, null, 2));
})();
