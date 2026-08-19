import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const url = SUPABASE_URL;
const anonKey = SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
export const isSupabaseConfigured = Boolean(supabase);

export async function loadTasks() {
  if (!supabase) return null;
  const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: true }).limit(2000);
  if (error) throw error;
  return data.map(({ created_at, due_date, company_code, ...task }) => ({
    ...task,
    dueDate: due_date || '',
    companyCode: company_code || '',
    createdAt: created_at,
  }));
}

export async function upsertTask(task) {
  if (!supabase) return;
  const { error } = await supabase.from('tasks').upsert({
    id: task.id, title: task.title, due_date: task.dueDate || null,
    company_code: task.companyCode || null, company: task.company || null,
    priority: task.priority, notes: task.notes || null, done: task.done,
    was_overdue: task.wasOverdue, created_at: task.createdAt,
  });
  if (error) throw error;
}

export async function removeTask(id) {
  if (!supabase) return;
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}
