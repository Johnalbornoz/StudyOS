'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMessages, Locale } from '@/lib/i18n/messages';

export default function UploadPanel({
  subjectId,
  subjectName,
  locale,
}: {
  subjectId: string;
  subjectName: string;
  locale: Locale;
}) {
  const t = getMessages(locale);
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
      if (!me.studentId) throw new Error(t['common.error']);

      setStatus(t['subjectDetail.statusUploading']);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('subjectId', subjectId);
      const uploadRes = await fetch('/api/content/upload', { method: 'POST', body: formData });
      const uploadBody = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadBody.error || t['common.error']);

      const text = uploadBody.extractedText;

      setStatus(t['subjectDetail.statusProcessing']);
      const processRes = await fetch('/api/content/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentSourceId: uploadBody.sourceId, text, sourceLanguage: locale }),
      });
      const processBody = await processRes.json();
      if (!processRes.ok) throw new Error(processBody.error || t['common.error']);

      setStatus(t['subjectDetail.statusExtracting']);
      const extractRes = await fetch('/api/content/extract-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: uploadBody.sourceId,
          studentId: me.studentId,
          subjectId,
          subjectName,
          sourceLanguage: locale,
        }),
      });
      const extractBody = await extractRes.json();
      if (!extractRes.ok) throw new Error(extractBody.error || t['common.error']);

      setExtractedCount(extractBody.data.conceptsCreated);
      router.refresh();
    } catch (err: any) {
      setError(err.message || t['common.error']);
    } finally {
      setLoading(false);
      setStatus(null);
      setFile(null);
    }
  };

  return (
    <div className="card" style={{ marginTop: 'var(--space-8)' }}>
      <h3 style={{ marginBottom: 4 }}>{t['subjectDetail.uploadTitle']}</h3>
      <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 var(--space-4)' }}>
        {t['subjectDetail.uploadBody']}
      </p>
      <form onSubmit={handleUpload} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        <input
          type="file"
          accept=".pdf,.txt,.docx,.jpg,.jpeg,.png,.webp,.gif"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          style={{ flex: 1, fontSize: 13.5 }}
        />
        <button type="submit" disabled={!file || loading} className="btn btn-primary">
          {loading ? t['subjectDetail.uploading'] : t['subjectDetail.uploadSubmit']}
        </button>
      </form>
      {status && <p style={{ marginTop: 'var(--space-3)', fontSize: 13.5, color: 'var(--text-muted)' }}>{status}</p>}
      {extractedCount !== null && (
        <p style={{ marginTop: 'var(--space-3)', fontSize: 13.5, color: 'var(--success)' }}>
          {extractedCount} {t['subjectDetail.extractedOk']}
        </p>
      )}
      {error && (
        <p style={{ marginTop: 'var(--space-3)', fontSize: 13.5, color: 'var(--error)' }}>{error}</p>
      )}
    </div>
  );
}
