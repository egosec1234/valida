import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type SubmissionStatus = "processing" | "complete" | "failed";

export type Submission = {
  id: string;
  user_id: string;
  idea_text: string;
  niche: string | null;
  score: number | null;
  report: Report | null;
  status: SubmissionStatus;
  error_message: string | null;
  created_at: string;
};

export type Report = {
  score: number;
  summary: string;
  risks: string[];
  competitors: { name: string; description: string; url?: string }[];
  recommendation: string;
};

export type TrackedNicheStatus = "pending_upgrade" | "active" | "canceled";

export type TrackedNiche = {
  id: string;
  user_id: string;
  submission_id: string;
  niche: string | null;
  status: TrackedNicheStatus;
  created_at: string;
};
