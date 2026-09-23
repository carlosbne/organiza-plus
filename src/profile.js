import { supabase } from './supabase.js';

/**
 * Normaliza a linha retornada pelo RPC get_my_status.
 * Retorna null quando não há perfil (ex.: usuário legacy sem backfill).
 */
export function normalizeProfile(row) {
  if (!row) return null;
  return {
    status: row.status ?? 'pending',
    role: row.role ?? 'user',
    email: row.email || '',
    rejectionReason: row.rejection_reason || '',
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at || null,
  };
}

export function isApproved(profile) {
  return profile?.status === 'approved';
}

export function isAdmin(profile) {
  return profile?.role === 'admin';
}

/**
 * Consulta o status do usuário logado via RPC.
 * Falha fechada: qualquer erro é propagado para o chamador decidir como bloquear.
 */
export async function getMyStatus() {
  if (!supabase) throw new Error('Supabase não configurado.');
  const { data, error } = await supabase.rpc('get_my_status');
  if (error) throw error;
  return normalizeProfile((Array.isArray(data) ? data[0] : data) ?? null);
}