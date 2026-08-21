'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function SubjectPage({ params }: { params: { id: string } }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [concepts, setConcepts] = useState<any[]>([]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('subjectId', params.id);

    try {
      const res = await fetch('/api/content/upload', {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        alert('Content uploaded! Now extracting concepts...');
        
        // Extract concepts
        const text = await file.text();
        const extractRes = await fetch('/api/concepts/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, subjectId: params.id }),
        });

        if (extractRes.ok) {
          const extracted = await extractRes.json();
          setConcepts(extracted.concepts || []);
        }
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem' }}>
      <Link href="/dashboard">← Back</Link>
      
      <h1>Subject Details</h1>
      <p>Subject ID: {params.id}</p>

      <h2>Upload Content</h2>
      <form onSubmit={handleUpload}>
        <input
          type="file"
          accept=".pdf,.txt,.docx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          style={{ marginBottom: '1rem' }}
        />
        <button
          type="submit"
          disabled={!file || loading}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Processing...' : 'Upload & Extract'}
        </button>
      </form>

      {concepts.length > 0 && (
        <>
          <h2>Extracted Concepts</h2>
          <ul>
            {concepts.map((c: any, i: number) => (
              <li key={i}>
                <strong>{c.label}</strong>: {c.description}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
