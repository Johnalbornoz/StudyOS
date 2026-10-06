/**
 * Where an item's content comes from -- a leaf module (no imports) so pure policy code (Question Bank delivery
 * rules) can name it without pulling the item / generation graph. Re-exported by `items.ts`.
 */
export const CONTENT_ORIGINS = ['OFFICIAL', 'LICENSED', 'GENERATED', 'FIXTURE'] as const;
export type ContentOrigin = (typeof CONTENT_ORIGINS)[number];
