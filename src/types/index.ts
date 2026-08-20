export type User = {
  id: string;
  email: string;
  full_name: string;
  user_type: 'admin' | 'parent' | 'student';
  created_at: Date;
};

export type Subject = {
  id: string;
  student_id: string;
  name: string;
  status: 'active' | 'archived';
};

export type Concept = {
  id: string;
  subject_id: string;
  canonical_id: string;
  label: string;
};

export type MasteryRecord = {
  id: string;
  student_id: string;
  concept_id: string;
  mastery_score: number;
  confidence_score: number;
  attempt_count: number;
};
