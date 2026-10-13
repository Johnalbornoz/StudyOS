/**
 * Files of the historical QB-R2E / QB-R2F generation freezes that have moved since.
 *
 * Those freezes hash the transitive source closure of two finished live runs. The runs stay reproducible at their
 * freeze commits (9fe68d0, 738b0f5); the stored manifests are not re-stamped. On this line ONE shared module of
 * that closure has changed, for a reason that has nothing to do with those runs, and it is named here so that the
 * freeze tests keep asserting that every OTHER frozen file is byte-identical -- and that the freeze itself refuses
 * a re-run at HEAD, naming exactly this file.
 *
 * Adding a path here is a statement that a frozen run's closure moved: it needs a reason, and a reviewer.
 */
export const MOVED_SINCE_QB_FREEZE: Readonly<Record<string, string>> = {
  'src/lib/catalog/concept-identity.ts':
    'Track B reviewed concept aliases (migration 20261122_1100): REVIEWED_ALIAS is a reviewed, canonical mapping method. Additive -- no existing mapping method classifies differently.',
};

const moved = (path: string) => Object.prototype.hasOwnProperty.call(MOVED_SINCE_QB_FREEZE, path);

/** A freeze manifest without the moved files (and without the hash over all of them): what must still be identical. */
export function unmovedPart(manifest: { files: ReadonlyArray<{ path: string }>; manifestHash: string }): Record<string, unknown> {
  const { manifestHash: _hash, ...rest } = manifest;
  void _hash;
  return { ...rest, files: manifest.files.filter((f) => !moved(f.path)) };
}

/** The paths of a manifest that must still match the freeze commit. */
export const unmovedPaths = (paths: readonly string[]): string[] => paths.filter((p) => !moved(p));

/** The refusal reasons the freeze gives at HEAD: exactly the moved files, and the hash that covers them. */
export const movedFileReasons = (): string[] => Object.keys(MOVED_SINCE_QB_FREEZE).map((p) => `FROZEN_FILE_CHANGED:${p}`);
