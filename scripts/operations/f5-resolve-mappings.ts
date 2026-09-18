/**
 * F5 cert helper -- resolves F4 concept_catalog_mapping rows for the
 * seeded fixture concepts via the real ensureCatalogMapping service, so
 * the certification can exercise MATCHED/AMBIGUOUS/UNRESOLVED behavior
 * exactly as production would produce it (never hand-crafted mapping
 * rows).
 */
import { ensureCatalogMapping } from '@/lib/catalog/mapping.service';

const CONCEPT_IDS = [
  'cccccccc-cccc-4ccc-8ccc-cccccccccc11', // L1 Linear Functions -> MATCHED
  'cccccccc-cccc-4ccc-8ccc-cccccccccc15', // L1 Quadratic Factoring -> UNRESOLVED (no canonical seeded)
  'cccccccc-cccc-4ccc-8ccc-cccccccccc13', // L1 Derivative Rules -> AMBIGUOUS
  'cccccccc-cccc-4ccc-8ccc-cccccccccc14', // L1 Novel Concept -> UNRESOLVED
  'cccccccc-cccc-4ccc-8ccc-cccccccccc21', // L2 Linear Functions -> MATCHED (same canonical as L1's)
];

async function main() {
  for (const conceptId of CONCEPT_IDS) {
    const mapping = await ensureCatalogMapping(conceptId);
    console.log(`  ${conceptId} -> ${mapping.status}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('f5-resolve-mappings failed:', err);
    process.exit(1);
  });
