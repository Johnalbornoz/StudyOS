'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function NewSubjectPage() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/subjects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (res.ok) {
        router.push('/dashboard');
        router.refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'No se pudo crear la materia');
      }
    } catch (err) {
      setError('Ocurrió un error de red');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <h1>Crear materia</h1>
      <p style={{ color: 'var(--text-secondary)', margin: '8px 0 var(--space-8)', fontSize: 15 }}>
        Dale un nombre a tu nueva materia — luego podrás subir contenido y practicar.
      </p>

      <form onSubmit={handleSubmit} className="card">
        <label className="label" style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>
          Nombre de la materia
        </label>
        <input
          type="text"
          placeholder="Ej. Matemáticas"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          style={{
            width: '100%',
            height: 44,
            padding: '0 var(--space-4)',
            marginBottom: 'var(--space-4)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-default)',
            fontSize: 14,
            fontFamily: 'inherit',
          }}
        />
        <button type="submit" disabled={loading || !name} className="btn btn-primary">
          {loading ? 'Creando…' : 'Crear materia'}
        </button>
        {error && <p style={{ color: 'var(--error)', fontSize: 13.5, marginTop: 'var(--space-3)' }}>{error}</p>}
      </form>

      <Link href="/dashboard" className="btn btn-ghost" style={{ marginTop: 'var(--space-4)' }}>
        ← Volver al panel
      </Link>
    </div>
  );
}
