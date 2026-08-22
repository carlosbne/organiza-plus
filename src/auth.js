import { isSupabaseConfigured, resetPasswordForEmail, signIn, signUp, updatePassword } from './supabase.js';

const $ = (selector) => document.querySelector(selector);
let signUpMode = false;

function showError(id, message = '') {
  const error = $(`#${id}`);
  error.textContent = message;
  error.hidden = !message;
}

function showCard(id) {
  for (const card of document.querySelectorAll('.auth-card')) card.hidden = card.id !== id;
}

$('#authToggle').addEventListener('click', () => {
  signUpMode = !signUpMode;
  $('#authTitle').textContent = signUpMode ? 'Criar sua conta' : 'Entrar na sua conta';
  $('#authSubtitle').textContent = signUpMode ? 'Comece a organizar sua rotina.' : 'Acesse seu fluxo de trabalho.';
  $('#authSubmit').textContent = signUpMode ? 'Criar conta' : 'Entrar';
  $('#authSwitchText').textContent = signUpMode ? 'Já tem uma conta?' : 'Ainda não tem uma conta?';
  $('#authToggle').textContent = signUpMode ? 'Entrar' : 'Criar conta';
  $('#authPassword').autocomplete = signUpMode ? 'new-password' : 'current-password';
  showCard(signUpMode ? 'registerCard' : 'loginCard');
  showError('authError');
});

$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('authError');
  try {
    if (!isSupabaseConfigured) throw new Error('O Supabase ainda não foi configurado.');
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const result = signUpMode ? await signUp(email, password) : await signIn(email, password);
    if (result.error) throw result.error;
    if (signUpMode && !result.data.session) showError('authError', 'Conta criada. Confirme seu e-mail para entrar.');
    else window.location.href = './index.html';
  } catch (error) { showError('authError', error.message); }
});

$('#forgotPassword').addEventListener('click', () => {
  showCard('forgotCard');
  showError('forgotError');
});

$('#forgotBack').addEventListener('click', () => {
  showCard('loginCard');
  showError('authError');
});

$('#registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('registerError');
  try {
    if (!isSupabaseConfigured) throw new Error('O Supabase ainda não foi configurado.');
    const result = await signUp($('#registerEmail').value.trim(), $('#registerPassword').value);
    if (result.error) throw result.error;
    if (result.data.session) window.location.href = './index.html';
    else showError('registerError', 'Conta criada. Confirme seu e-mail para entrar.');
  } catch (error) { showError('registerError', error.message); }
});

$('#registerToggle').addEventListener('click', () => {
  signUpMode = false;
  showCard('loginCard');
  showError('authError');
});

$('#forgotForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('forgotError');
  try {
    if (!isSupabaseConfigured) throw new Error('O Supabase ainda não foi configurado.');
    const result = await resetPasswordForEmail($('#forgotEmail').value.trim(), `${window.location.origin}/auth.html`);
    if (result.error) throw result.error;
    showError('forgotError', 'Link enviado. Verifique sua caixa de entrada.');
  } catch (error) { showError('forgotError', error.message); }
});

$('#resetForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('resetError');
  const password = $('#resetPassword').value;
  if (password !== $('#resetPasswordConfirmation').value) {
    showError('resetError', 'As senhas não coincidem.');
    return;
  }
  try {
    const result = await updatePassword(password);
    if (result.error) throw result.error;
    window.location.href = './index.html';
  } catch (error) { showError('resetError', error.message); }
});

if (new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery') showCard('resetCard');
else showCard('loginCard');
