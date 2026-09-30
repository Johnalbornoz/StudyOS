import { Skeleton } from '@/components/ui/Skeleton';

/** UX-4: a stable skeleton of the knowledge map while the authoritative read runs. */
export default function KnowledgeLoading() {
  return (
    <div className="xp-page xp-page--wide" role="status" aria-busy="true">
      <Skeleton height={32} width="40%" />
      <div className="kn-counts" style={{ marginTop: 'var(--space-6)' }}>
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={84} radius="var(--radius-md)" />)}
      </div>
      <div className="kn-topics" style={{ marginTop: 'var(--space-8)' }}>
        {[0, 1].map((i) => <Skeleton key={i} height={220} radius="var(--radius-md)" />)}
      </div>
    </div>
  );
}
