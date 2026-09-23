import { getSession, isSupabaseConfigured, onAuthStateChange, signOut } from './supabase.js';
import { getMyStatus, isAdmin, isApproved } from './profile.js';

let currentSession = null;
let currentProfile = null;

function updateAuthNavigation() {
  const link = document.querySelector('#logoutLink');
  if (!link) return;
  if (currentSession) {
    link.textContent = 'Sair';
    link.href = '#logout';
    link.setAttribute('aria-label', 'Sair da conta');
  } else {
    link.textContent = 'Entrar';
    link.href = './auth';
    link.removeAttribute('aria-label');
  }
  const adminLink = document.querySelector('#adminLink');
  if (adminLink) adminLink.hidden = !isAdmin(currentProfile);
}

function configureMobileNavigation() {
  const toggle = document.querySelector('#menuToggle');
  const nav = document.querySelector('#primaryNav');
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
    if (event.target.closest('a') && event.target.closest('a') !== document.querySelector('#logoutLink')) close();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
}

function configureDialogs() {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-dialog]');
    if (trigger) {
      const dialog = document.getElementById(trigger.dataset.dialog);
      if (dialog?.showModal) dialog.showModal();
    }
  });
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

async function configureSession() {
  if (!isSupabaseConfigured) return true;

  currentSession = (await getSession()).data.session;
  if (!currentSession) {
    window.location.replace('./auth');
    return false;
  }

  let profile = null;
  try {
    profile = await getMyStatus();
  } catch {
    profile = null;
  }
  currentProfile = profile;
  updateAuthNavigation();
  if (!isApproved(profile)) {
    window.location.replace('./status');
    return false;
  }

  onAuthStateChange((_event, session) => {
    currentSession = session;
    if (!session) {
      currentProfile = null;
      updateAuthNavigation();
      window.location.replace('./auth');
      return;
    }
    getMyStatus()
      .then((next) => {
        currentProfile = next;
        updateAuthNavigation();
        if (!isApproved(next)) window.location.replace('./status');
      })
      .catch((error) => {
        // Falha transitória: mantém a sessão; o fail-closed estrito ocorre no init.
        console.warn('Supabase: falha ao consultar o status do perfil.', error);
      });
  });
  return true;
}

async function init() {
  configureMobileNavigation();
  configureDialogs();
  document.querySelector('#logoutLink')?.addEventListener('click', async (event) => {
    if (!currentSession) return;
    event.preventDefault();
    const link = event.currentTarget;
    link.setAttribute('aria-busy', 'true');
    link.textContent = 'Saindo…';
    try {
      const result = await signOut();
      if (result?.error) throw result.error;
      window.location.replace('./auth');
    } catch (error) {
      console.error('Supabase: não foi possível encerrar a sessão.', error);
      link.removeAttribute('aria-busy');
      updateAuthNavigation();
    }
  });
  await configureSession();
}

init();
