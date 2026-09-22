'use client';

import { useState, useEffect } from 'react';

interface Option {
  studentId: string;
  email: string;
  ownerUserId: string | null;
}

export type BeneficiarySelection = Option;

/**
 * Muestra el correo completo (no enmascarado) del estudiante: quien
 * aprueba un pago o concede una licencia debe poder confirmar con
 * certeza a quién le está dando acceso antes de comprometer dinero o
 * una licencia a esa cuenta. `ownerUserId` viaja con la selección para
 * que el formulario pueda detectar una autoaprobación (comparándolo
 * contra el id del propio admin) antes de enviar -- el servidor
 * siempre recalcula esto de forma independiente.
 */
export function BeneficiaryPicker({ value, onChange }: { value: BeneficiarySelection | null; onChange: (v: BeneficiarySelection | null) => void }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (value || query.trim().length < 2) {
      setOptions([]);
      return;
    }
    const handle = setTimeout(() => {
      fetch(`/api/admin/memberships/students/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((b) => { setOptions(b.data.items); setOpen(true); })
        .catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query, value]);

  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2)', border: '1px solid var(--border-default)', borderRadius: 6 }}>
        <span style={{ fontSize: 13 }}>Beneficiario: <strong>{value.email}</strong></span>
        <button type="button" className="btn btn-ghost" onClick={() => onChange(null)} style={{ marginLeft: 'auto' }}>Cambiar</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 4 }}>Estudiante beneficiario</label>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por correo del estudiante…"
        style={{ width: '100%', padding: 'var(--space-2)' }}
        aria-autocomplete="list"
      />
      {open && options.length > 0 && (
        <ul style={{ position: 'absolute', zIndex: 10, background: 'var(--surface-default, #fff)', border: '1px solid var(--border-default)', borderRadius: 6, width: '100%', marginTop: 2, maxHeight: 220, overflowY: 'auto', listStyle: 'none', padding: 0 }}>
          {options.map((o) => (
            <li key={o.studentId}>
              <button
                type="button"
                onClick={() => { onChange({ studentId: o.studentId, email: o.email, ownerUserId: o.ownerUserId }); setQuery(''); setOptions([]); setOpen(false); }}
                style={{ width: '100%', textAlign: 'left', padding: 'var(--space-2)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}
              >
                {o.email}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim().length >= 2 && options.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Sin coincidencias.</p>
      )}
    </div>
  );
}
