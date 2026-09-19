'use client';
import { useEffect, useState } from 'react';
type Institution={institutionId:string;name:string};
type Overview={activeLearnerCount:number|null;minimumCohortSize:number;suppressed:boolean;grades:Array<{gradeId:string;name:string;activeLearnerCount:number|null;suppressed:boolean}>;classes:Array<{classId:string;gradeId:string|null;name:string;activeLearnerCount:number|null;suppressed:boolean}>};
export default function InstitutionDashboard(){
 const [institutions,setInstitutions]=useState<Institution[]>([]),[id,setId]=useState(''),[data,setData]=useState<Overview|null>(null),[loading,setLoading]=useState(true);
 useEffect(()=>{fetch('/api/institution-intelligence/institutions').then(r=>r.json()).then(b=>{const x=b.data?.institutions||[];setInstitutions(x);setId(x[0]?.institutionId||'');setLoading(false)});},[]);
 useEffect(()=>{if(!id)return; fetch(`/api/institution-intelligence/overview?institutionId=${encodeURIComponent(id)}`).then(r=>r.json()).then(b=>setData(b.data||null));},[id]);
 const rows=(title:string,items:Array<{name:string;activeLearnerCount:number|null;suppressed:boolean}>)=><section className="card" style={{marginTop:16}}><h2 style={{fontSize:18}}>{title}</h2><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th style={{textAlign:'left'}}>Segmento</th><th style={{textAlign:'right'}}>Estudiantes activos</th></tr></thead><tbody>{items.map(x=><tr key={`${title}-${x.name}`} style={{borderTop:'1px solid var(--border-default)'}}><td style={{padding:'10px 0'}}>{x.name}</td><td style={{textAlign:'right'}}>{x.suppressed?'Datos insuficientes':x.activeLearnerCount}</td></tr>)}</tbody></table></section>;
 if(loading)return <p>Cargando tablero…</p>;
 if(!institutions.length)return <div className="card"><h1>Inteligencia institucional</h1><p>No tienes una institución asignada para este tablero.</p></div>;
 return <div><h1>Inteligencia institucional</h1><p style={{color:'var(--text-secondary)'}}>Vista agregada para orientar decisiones académicas. Los grupos menores de 10 estudiantes se protegen.</p><label>Institución<br/><select value={id} onChange={e=>setId(e.target.value)}>{institutions.map(i=><option key={i.institutionId} value={i.institutionId}>{i.name}</option>)}</select></label>{data&&<><div className="card" style={{marginTop:16}}><strong>Estudiantes activos</strong><div style={{fontSize:32,marginTop:8}}>{data.suppressed?'Datos insuficientes':data.activeLearnerCount}</div></div>{rows('Por grado',data.grades)}{rows('Por clase',data.classes)}</>}</div>
}
