'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UploadPanel({ subjectId }: { subjectId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [extractedCount, setExtractedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('subjectId', subjectId);

      const res = await fetch('/api/content/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'No se pudo subir el archivo');
      }

      const text = await file.text();
      const extractRes = await fetch('/api/concepts/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, subjectId }),
      });

      if (extractRes.ok) {
        const extracted = await extractRes.json();
        setExtractedCount(extracted.concepts?.length || 0);
        router.refresh();
      } else {
        throw new Error('El archivo se subió, pero no se pudieron extraer conceptos');
      }
    } catch (err: any) {
      setError(err.message || 'Ocurrió un error');
    } finally {
      setLoading(false);
      setFile(null);
    }
  };

  return (
    <div className="card" style={{ marginTop: 'var(--space-8)' }}>
      <h3 style={{ marginBottom: 4 }}>Sube material de estudio</h3>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 var(--space-4)' }}>
        Sube un PDF o texto — extraemos los conceptos automáticamente con IA.
      </p>
      <form onSubmit={handleUpload} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        <input
          type="file"
          accept=".pdf,.txt,.docx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          style={{ flex: 1, fontSize: 13.5 }}
        />
        <button type="submit" disabled={!file || loading} className="btn btn-primary">
          {loading ? 'Procesando…' : 'Subir y extraer'}
        </button>
      </form>
      {extractedCount !== null && (
        <p style={{ marginTop: 'var(--space-3)', fontSize: 13.5, color: 'var(--success)' }}>
          Se extrajeron {extractedCount} conceptos nuevos.
        </p>
      )}
      {error && (
        <p style={{ marginTop: 'var(--space-3)', fontSize: 13.5, color: 'var(--error)' }}>{error}</p>
      )}
    </div>
  );
}
