import {
  adminListHistory,
  adminListProfiles,
  adminReopen,
  adminReview,
  getSession,
  isSupabaseConfigured,
  signOut,
} from './supabase.js';
import { getMyStatus, isAdmin } from './profile.js';

const $ = (selector) => document.querySelector(selector);
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const reviewDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

let profiles = [];
let currentTab = 'pending';
let rejectTarget = null;

const STATUS_LABEL = Object.freeze({
  pending: 'Pendente',
  approved: 'Aprovado',
  blocked: 'Bloqueado',
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function initials(email) {
  const local = (email || '').split('@')[0] || '?';
  const parts = local.replace(/[._-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '');
  return (letters || '?').toUpperCase().slice(0, 2);
}

function pillClass(status) {
  return `status-pill is-${status}`;
}

function actionButton(label, action, id, className = '') {
  const button = element('button', `button small ${className}`.trim(), label);
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function renderProfile(profile) {
  const item = element('article', 'admin-item');
  const avatar = element('span', `avatar${profile.status === 'blocked' ? ' is-blocked' : ''}`, initials(profile.email));
  avatar.setAttribute('aria-hidden', 'true');

  const identity = element('div', 'admin-item-id');
  identity.append(
    element('strong', '', profile.email || 'E-mail não informado'),
    element('small', '', `Solicitado em ${shortDate.format(new Date(profile.created_at))}`),
  );
  if (profile.reviewed_at) {
    identity.append(element('small', '', `Última ação em ${reviewDate.format(new Date(profile.reviewed_at))}`));
  }
  if (profile.role === 'admin') identity.append(element('small', '', 'Administrador'));

  const actions = element('div', 'admin-item-actions');
  actions.append(element('span', `status-pill ${pillClass(profile.status)}`, STATUS_LABEL[profile.status] || profile.status));

  if (profile.status === 'pending') {
    actions.append(actionButton('Rejeitar', 'reject', profile.id, 'danger'));
    actions.append(actionButton('Aprovar', 'approve', profile.id, 'primary'));
  } else if (profile.status === 'approved') {
    actions.append(actionButton('Bloquear', 'block', profile.id, 'danger'));
  } else if (profile.status === 'blocked') {
    actions.append(actionButton('Reabrir', 'reopen', profile.id, 'gold'));
  }

  item.append(avatar, identity, actions);
  return item;
}

function renderList() {
  const list = $('#profileList');
  const wrap = $('#historyWrap');
  const empty = $('#listEmpty');
  const listTitle = $('#listTitle');

  if (currentTab === 'history') {
    list.hidden = true;
    wrap.hidden = false;
    empty.hidden = true;
    listTitle.textContent = 'Histórico de decisões';
    return;
  }

  wrap.hidden = true;
  list.hidden = false;
  const filtered = profiles.filter((profile) => profile.status === currentTab);
  list.replaceChildren(...filtered.map(renderProfile));
  empty.hidden = filtered.length > 0;
  const label = { pending: 'Fila de aprovação', approved: 'Aprovados', blocked: 'Bloqueados' }[currentTab];
  listTitle.textContent = label;
  $('#listCountPill').textContent = `${label === 'Fila de aprovação' ? 'Pendentes' : label}: ${filtered.length}`;
}

function renderStats() {
  const counts = { pending: 0, approved: 0, blocked: 0 };
  for (const profile of profiles) {
    counts[profile.status] = (counts[profile.status] ?? 0) + 1;
  }
  $('#statPending').textContent = String(counts.pending);
  $('#statApproved').textContent = String(counts.approved);
  $('#statBlocked').textContent = String(counts.blocked);
  $('#tabPendingCount').textContent = String(counts.pending);
  $('#tabApprovedCount').textContent = String(counts.approved);
  $('#tabBlockedCount').textContent = String(counts.blocked);
  $('#listCountPill').textContent = `Pendentes: ${counts.pending}`;
}

function renderHistory(rows) {
  $('#historyBody').replaceChildren(...rows.map((row) => {
    const tr = element('tr');
    const actionClass = { approved: 'approve', blocked: 'reject', reopened: 'reopen' }[row.action] || 'reopen';
    const actionCell = element('td', '');
    actionCell.append(element('span', `history-action ${actionClass}`, {
      approved: 'Aprovado', blocked: 'Rejeitado', reopened: 'Reaberto',
    }[row.action] || row.action));
    tr.append(
      element('td', '', row.profile_email || '—'),
      actionCell,
      element('td', '', row.reason || '—'),
      element('td', '', row.actor_email || '—'),
      element('td', '', row.created_at ? reviewDate.format(new Date(row.created_at)) : '—'),
    );
    return tr;
  }));
}

function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.admin-tabs .tab').forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  if (tab === 'history') {
    $('#adminHint').textContent = 'Acompanhe aqui todas as decisões registradas pelos administradores.';
  } else {
    $('#adminHint').textContent = 'Cadastros pendentes não têm acesso a tarefas nem ferramentas. Aprove para liberar; rejeite para bloquear (o motivo aparece na tela do usuário).';
  }
  renderList();
}

async function loadData() {
  const [{ data: profileRows, error: profileError }, { data: historyRows, error: historyError }] = await Promise.all([
    adminListProfiles(null),
    adminListHistory(30),
  ]);
  if (profileError) throw profileError;
  if (historyError) throw historyError;
  profiles = Array.isArray(profileRows) ? profileRows : [];
  renderStats();
  renderHistory(Array.isArray(historyRows) ? historyRows : []);
  renderList();
}

async function withConfirmation(message, callback) {
  if (!window.confirm(message)) return;
  try {
    await callback();
    await loadData();
  } catch (error) {
    window.alert(`Não foi possível concluir a ação: ${error.message}`);
  }
}

function handleProfileAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  const profile = profiles.find((item) => item.id === id);
  const email = profile?.email || 'este cadastro';

  if (action === 'approve') {
    withConfirmation(`Aprovar o cadastro de ${email}? O acesso será liberado imediatamente.`, () => adminReview(id, 'approved'));
  } else if (action === 'block') {
    withConfirmation(`Bloquear o acesso de ${email}? O cadastro perderá o acesso imediatamente.`, () => adminReview(id, 'blocked'));
  } else if (action === 'reopen') {
    withConfirmation(`Reabrir o cadastro de ${email}? Ele voltará para a fila de aprovação.`, () => adminReopen(id));
  } else if (action === 'reject') {
    rejectTarget = { id, email };
    $('#rejectTargetEmail').textContent = email;
    $('#rejectReason').value = '';
    setError($('#rejectError'));
    $('#rejectDialog').showModal();
  }
}

function setError(element, message = '') {
  element.textContent = message;
  element.hidden = !message;
}

function configureRejectDialog() {
  const dialog = $('#rejectDialog');
  $('#rejectCancel').addEventListener('click', () => dialog.close());

  $('#rejectDialog form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!rejectTarget) return;
    const reason = $('#rejectReason').value.trim();
    if (reason.length > 500) {
      setError($('#rejectError'), 'O motivo deve ter no máximo 500 caracteres.');
      return;
    }
    const confirmButton = $('#rejectConfirm');
    confirmButton.disabled = true;
    confirmButton.textContent = 'Rejeitando…';
    try {
      await adminReview(rejectTarget.id, 'blocked', reason || null);
      dialog.close();
      rejectTarget = null;
      await loadData();
    } catch (error) {
      setError($('#rejectError'), error.message);
    } finally {
      confirmButton.disabled = false;
      confirmButton.textContent = 'Rejeitar cadastro';
    }
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function configureMobileNavigation() {
  const toggle = $('#menuToggle');
  const nav = $('#primaryNav');
  if (!toggle || !nav) return;
  const close = () => {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir menu');
    nav.classList.remove('is-open');
  };
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    nav.classList.toggle('is-open', open);
  });
  nav.addEventListener('click', (event) => {
    if (event.target.closest('a') && !event.target.closest('#logoutLink')) close();
  });
}

async function init() {
  $('#todayLabel').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date());
  configureMobileNavigation();
  configureRejectDialog();
  document.querySelectorAll('.admin-tabs .tab').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
  $('#profileList').addEventListener('click', handleProfileAction);
  $('#deniedBackButton').addEventListener('click', () => window.location.replace('./'));

  if (!isSupabaseConfigured) {
    $('#accessDenied').hidden = false;
    $('#accessDenied h2').textContent = 'Autenticação indisponível';
    return;
  }

  let session = null;
  try {
    const result = await getSession();
    session = result.data.session;
  } catch (error) {
    $('#adminContent').hidden = true;
    $('#accessDenied').hidden = false;
    $('#deniedTitle').textContent = 'Não foi possível verificar o acesso';
    $('#accessDenied .status-lead').textContent = `Houve um problema ao confirmar sua sessão: ${error.message}. Tente novamente em instantes.`;
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
    profile = null;
  }

  if (!isAdmin(profile)) {
    $('#adminContent').hidden = true;
    $('#accessDenied').hidden = false;
    return;
  }

  $('#accessDenied').hidden = true;
  $('#adminContent').hidden = false;
  try {
    await loadData();
  } catch (error) {
    $('#adminContent').hidden = true;
    $('#accessDenied').hidden = false;
    $('#deniedTitle').textContent = 'Não foi possível carregar a administração';
    $('#accessDenied .status-lead').textContent = `Ocorreu um erro ao consultar a fila de aprovação: ${error.message}`;
  }

  $('#logoutLink').addEventListener('click', async (event) => {
    event.preventDefault();
    await signOut();
    window.location.replace('./auth');
  });
}

init();