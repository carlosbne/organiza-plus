import { isSupabaseConfigured, signIn, signUp } from './supabase.js';

const $ = (selector) => document.querySelector(selector);
let signUpMode = false;

function showError(message = '') {
  const error = $('#authError');
  error.textContent = message;
  error.hidden = !message;
}

$('#authToggle').addEventListener('click', () => {
  signUpMode = !signUpMode;
  $('#authTitle').textContent = signUpMode ? 'Criar sua conta' : 'Entrar na sua conta';
  $('#authSubtitle').textContent = signUpMode ? 'Comece a organizar sua rotina.' : 'Acesse seu fluxo de trabalho.';
  $('#authSubmit').textContent = signUpMode ? 'Criar conta' : 'Entrar';
  $('#authSwitchText').textContent = signUpMode ? 'Já tem uma conta?' : 'Ainda não tem uma conta?';
  $('#authToggle').textContent = signUpMode ? 'Entrar' : 'Criar conta';
  $('#authPassword').autocomplete = signUpMode ? 'new-password' : 'current-password';
  showError();
});

$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError();
  try {
    if (!isSupabaseConfigured) throw new Error('O Supabase ainda não foi configurado.');
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const result = signUpMode ? await signUp(email, password) : await signIn(email, password);
    if (result.error) throw result.error;
    if (signUpMode && !result.data.session) showError('Conta criada. Confirme seu e-mail para entrar.');
    else window.location.href = './index.html';
  } catch (error) { showError(error.message); }
});
