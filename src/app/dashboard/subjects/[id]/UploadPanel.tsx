'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function UploadPanel({ subjectId, subjectName }: { subjectId: string; subjectName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [extractedCount, setExtractedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError(null);
    setExtractedCount(null);

    try {
      const meRes = await fetch('/api/me');
      const me = await meRes.json();
      if (!me.studentId) throw new Error('No se pudo identificar al estudiante');

      setStatus('Subiendo archivo…');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('subjectId', subjectId);
      const uploadRes = await fetch('/api/content/upload', { method: 'POST', body: formData });
      const uploadBody = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadBody.error || 'No se pudo subir el archivo');

      const text = await file.text();

      setStatus('Procesando contenido (chunking + embeddings)…');
      const processRes = await fetch('/api/content/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentSourceId: uploadBody.sourceId, text, sourceLanguage: 'es' }),
      });
      const processBody = await processRes.json();
      if (!processRes.ok) throw new Error(processBody.error || 'No se pudo procesar el contenido');

      setStatus('Extrayendo conceptos con IA…');
      const extractRes = await fetch('/api/content/extract-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: uploadBody.sourceId,
          studentId: me.studentId,
          subjectId,
          subjectName,
          sourceLanguage: 'es',
        }),
      });
      const extractBody = await extractRes.json();
      if (!extractRes.ok) throw new Error(extractBody.error || 'No se pudieron extraer conceptos');

      setExtractedCount(extractBody.data.conceptsCreated);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Ocurrió un error');
    } finally {
      setLoading(false);
      setStatus(null);
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
      {status && <p style={{ marginTop: 'var(--space-3)', fontSize: 13.5, color: 'var(--text-muted)' }}>{status}</p>}
      {extractedCount !== null && (
        <p style={{ marginTop: 'var(--space-3)', fontSize: 13.5, color: 'var(--success)' }}>
          Se extrajeron {extractedCount} conceptos nuevos, vinculados a tu contenido.
        </p>
      )}
      {error && (
        <p style={{ marginTop: 'var(--space-3)', fontSize: 13.5, color: 'var(--error)' }}>{error}</p>
      )}
    </div>
  );
}
