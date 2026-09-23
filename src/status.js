import { getSession, isSupabaseConfigured, signOut } from './supabase.js';
import { getMyStatus, isApproved } from './profile.js';

const $ = (selector) => document.querySelector(selector);
const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

function showCard(id) {
  for (const card of document.querySelectorAll('.auth-card')) card.hidden = card.id !== id;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormat.format(date);
}

async function init() {
  if (!isSupabaseConfigured) {
    window.location.replace('./auth');
    return;
  }

  let session = null;
  try {
    const result = await getSession();
    session = result.data.session;
  } catch {
    // Sessão ilegível (ex.: storage corrompido): falha fechada, sem redeirecionar em loop.
    showCard('unknownCard');
    return;
  }
  if (!session) {
    window.location.replace('./auth');
    return;
  }

  let profile = null;
  try {
    profile = await getMyStatus();
  } catch {
    // Falha ao consultar => tela de falha fechada (não libera acesso).
    showCard('unknownCard');
    return;
  }

  if (isApproved(profile)) {
    window.location.replace('./');
    return;
  }

  if (!profile) {
    // Usuário sem perfil: não liberar acesso até existir decisão.
    showCard('unknownCard');
    return;
  }

  if (profile.status === 'blocked') {
    const email = profile.email || session.user.email || '—';
    $('#blockedEmail').textContent = email;
    $('#blockedDate').textContent = formatDate(profile.reviewedAt);
    if (profile.rejectionReason) {
      $('#blockedReasonText').textContent = profile.rejectionReason;
      $('#blockedReason').hidden = false;
    }
    showCard('blockedCard');
    return;
  }

  // pending (padrão) ⇒ tela "em análise"
  $('#pendingEmail').textContent = profile.email || session.user.email || '—';
  $('#pendingDate').textContent = formatDate(profile.createdAt);
  showCard('pendingCard');
}

function signOutFromPage(event) {
  const button = event.currentTarget;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Saindo…';
  signOut()
    .then(() => window.location.replace('./auth'))
    .catch(() => {
      button.removeAttribute('aria-busy');
      button.textContent = 'Sair da conta';
    });
}

for (const id of ['signOutButton', 'signOutButtonBlocked', 'signOutButtonUnknown']) {
  $(`#${id}`).addEventListener('click', signOutFromPage);
}

init();