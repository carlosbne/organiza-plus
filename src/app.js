import {
  calculateAdditions,
  calculateEmploymentCost,
  createTask,
  getTaskStats,
  isTaskOverdue,
  parseStoredTasks,
} from './core.js';

const STORAGE_KEY = 'organizaPlus.tasks.v3';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const longDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
const $ = (selector, root = document) => root.querySelector(selector);

let tasks = parseStoredTasks(localStorage.getItem(STORAGE_KEY));
let activeFilter = 'all';
let editingId = null;

function localDateKey(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function setError(element, message = '') {
  element.textContent = message;
  element.hidden = !message;
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function taskMeta(task, overdue) {
  const meta = element('div', 'task-meta');
  const priority = element('span', 'priority-badge', `Prioridade ${task.priority}`);
  meta.append(priority);
  if (task.companyCode || task.company) meta.append(element('span', '', [task.companyCode, task.company].filter(Boolean).join(' · ')));
  if (task.dueDate) {
    const date = new Date(`${task.dueDate}T12:00:00`);
    meta.append(element('span', '', `${overdue ? 'Atrasada · ' : 'Prazo · '}${shortDate.format(date)}`));
  }
  if (task.done && task.wasOverdue) meta.append(element('span', '', 'Concluída com atraso'));
  return meta;
}

function actionButton(label, action, id, className = '') {
  const button = element('button', className, label);
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function renderTask(task) {
  const overdue = isTaskOverdue(task, localDateKey());
  const card = element('article', `task-card priority-${task.priority}${overdue ? ' is-overdue' : ''}${task.done ? ' is-done' : ''}`);
  const top = element('div', 'task-top');
  top.append(element('h3', 'task-title', task.title));
  if (overdue) top.append(element('span', 'priority-badge', 'Atrasada'));
  card.append(top, taskMeta(task, overdue));
  if (task.notes) card.append(element('p', 'task-notes', task.notes));

  const actions = element('div', 'task-actions');
  if (!task.done) {
    actions.append(
      actionButton('Agenda', 'calendar', task.id),
      actionButton('Editar', 'edit', task.id),
      actionButton('Concluir', 'complete', task.id, 'complete'),
    );
  }
  actions.append(actionButton('Excluir', 'delete', task.id, 'delete'));
  card.append(actions);
  return card;
}

function filteredTasks() {
  if (activeFilter === 'pending') return tasks.filter((task) => !task.done);
  if (activeFilter === 'done') return tasks.filter((task) => task.done);
  if (activeFilter === 'overdue') return tasks.filter((task) => isTaskOverdue(task, localDateKey()));
  return tasks;
}

function render() {
  const list = $('#taskList');
  const visible = filteredTasks().sort((a, b) => Number(a.done) - Number(b.done) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  list.replaceChildren(...visible.map(renderTask));
  $('#emptyState').hidden = visible.length > 0;

  const stats = getTaskStats(tasks, localDateKey());
  $('#rate').textContent = `${stats.efficiency}%`;
  $('#pendingCount').textContent = String(stats.pending);
  $('#overdueCount').textContent = String(stats.overdue);
  $('#doneCount').textContent = String(stats.completed);
  $('#lateDoneLabel').textContent = `${stats.completedLate} com atraso`;
  $('#ringValue').textContent = `${stats.efficiency}%`;
  const ring = $('#progressRing');
  $('#progressCircle').setAttribute('stroke-dasharray', `${stats.efficiency} 100`);
  ring.setAttribute('aria-label', `Progresso de ${stats.efficiency}%`);
  saveTasks();
}

function resetTaskForm() {
  editingId = null;
  $('#taskForm').reset();
  $('#taskPriority').value = 'media';
  $('#formTitle').textContent = 'Nova tarefa';
  $('#submitLabel').textContent = 'Adicionar ao fluxo';
  $('#cancelEdit').hidden = true;
  setError($('#taskError'));
}

function taskInput() {
  return {
    title: $('#taskTitle').value,
    dueDate: $('#taskDate').value,
    companyCode: $('#companyCode').value,
    company: $('#companyName').value,
    priority: $('#taskPriority').value,
    notes: $('#taskNotes').value,
  };
}

function submitTask(event) {
  event.preventDefault();
  try {
    if (editingId) {
      const old = tasks.find((task) => task.id === editingId);
      const updated = createTask({ ...taskInput(), done: old.done, wasOverdue: old.wasOverdue }, { id: old.id, now: old.createdAt });
      tasks = tasks.map((task) => task.id === editingId ? updated : task);
    } else {
      tasks = [...tasks, createTask(taskInput())];
    }
    resetTaskForm();
    render();
  } catch (error) {
    setError($('#taskError'), error.message);
  }
}

function startEdit(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  editingId = id;
  $('#taskTitle').value = task.title;
  $('#taskDate').value = task.dueDate;
  $('#companyCode').value = task.companyCode;
  $('#companyName').value = task.company;
  $('#taskPriority').value = task.priority;
  $('#taskNotes').value = task.notes;
  $('#formTitle').textContent = 'Editar tarefa';
  $('#submitLabel').textContent = 'Salvar alterações';
  $('#cancelEdit').hidden = false;
  $('#taskTitle').focus();
}

function completeTask(id) {
  const today = localDateKey();
  tasks = tasks.map((task) => task.id === id
    ? createTask({ ...task, done: true, wasOverdue: task.wasOverdue || isTaskOverdue(task, today) }, { id: task.id, now: task.createdAt })
    : task);
  render();
}

function deleteTask(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task || !window.confirm(`Excluir a tarefa “${task.title}”?`)) return;
  tasks = tasks.filter((item) => item.id !== id);
  if (editingId === id) resetTaskForm();
  render();
}

function addOneDay(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return localDateKey(date).replaceAll('-', '');
}

function openCalendar(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task?.dueDate) {
    window.alert('Defina um prazo para vincular a tarefa à agenda.');
    return;
  }
  const start = task.dueDate.replaceAll('-', '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: task.title,
    dates: `${start}/${addOneDay(task.dueDate)}`,
    details: task.notes || task.company,
  });
  window.open(`https://calendar.google.com/calendar/render?${params}`, '_blank', 'noopener,noreferrer');
}

function handleTaskAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'edit') startEdit(id);
  if (action === 'complete') completeTask(id);
  if (action === 'delete') deleteTask(id);
  if (action === 'calendar') openCalendar(id);
}

function resultRow(label, value, className = '') {
  const row = element('div', `result-row ${className}`.trim());
  row.append(element('span', '', label), element('strong', '', value));
  return row;
}

function updateAdditions() {
  const error = $('#calcError');
  try {
    const result = calculateAdditions({
      salary: $('#calcSalary').value,
      divisor: $('#calcDivisor').value,
      overtimePercent: $('#overtimePercent').value,
      overtime: $('#overtimeHours').value,
      nightPercent: $('#nightPercent').value,
      nightHours: $('#nightHours').value,
      workdays: $('#workdays').value,
      restDays: $('#restDays').value,
    });
    const box = $('#calcResult');
    box.replaceChildren(
      element('h3', '', 'Resumo do cálculo'),
      resultRow('Valor da hora', brl.format(result.hourlyRate)),
      resultRow(`Horas extras (${result.overtimeHours}h)`, brl.format(result.overtimeValue)),
      resultRow(`Adic. noturno (${result.reducedNightHours}h reduzidas)`, brl.format(result.nightValue)),
      resultRow('DSR sobre adicionais', brl.format(result.dsrValue)),
      resultRow('Total de adicionais', brl.format(result.total), 'result-total'),
    );
    setError(error);
  } catch (exception) {
    $('#calcResult').replaceChildren(element('p', '', 'Revise os campos para visualizar o resultado.'));
    setError(error, exception.message);
  }
}

function tableRow(label, rule, value) {
  const row = document.createElement('tr');
  row.append(element('td', '', label), element('td', '', rule), element('td', '', brl.format(value)));
  return row;
}

function updateCost() {
  const error = $('#costError');
  try {
    const result = calculateEmploymentCost({
      salary: $('#costSalary').value,
      taxRegime: $('#taxRegime').value,
      transport: $('#transport').value,
      meal: $('#meal').value,
      benefits: $('#benefits').value,
    });
    const summary = $('#costSummary');
    const copy = element('div');
    copy.append(element('h3', '', 'Custo mensal estimado'), element('small', '', `${result.regimeLabel} · acréscimo de ${result.overheadPercent}% sobre o salário`));
    summary.replaceChildren(copy, element('strong', '', brl.format(result.totalMonthlyCost)));
    $('#costTable').replaceChildren(
      tableRow('Salário bruto', 'Base', result.salary),
      tableRow('Férias', '1/12', result.vacation),
      tableRow('1/3 de férias', '1/3 da provisão', result.vacationThird),
      tableRow('13º salário', '1/12', result.thirteenthSalary),
      tableRow('FGTS mensal', '8%', result.monthlyFgts),
      tableRow('FGTS sobre provisões', '8%', result.provisionsFgts),
      tableRow('Reserva rescisória', '40% do FGTS estimado', result.terminationReserve),
      tableRow('CPP patronal', 'Conforme regime', result.cpp),
      tableRow('RAT / FAP estimado', 'Conforme regime', result.rat),
      tableRow('Terceiros', 'Conforme regime', result.thirdParties),
      tableRow('Benefícios líquidos', 'VT empresa + demais', result.totalBenefits),
    );
    setError(error);
  } catch (exception) {
    $('#costSummary').replaceChildren();
    $('#costTable').replaceChildren();
    setError(error, exception.message);
  }
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

function init() {
  $('#todayLabel').textContent = longDate.format(new Date());
  $('#taskForm').addEventListener('submit', submitTask);
  $('#cancelEdit').addEventListener('click', resetTaskForm);
  $('#taskList').addEventListener('click', handleTaskAction);
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('is-active', item === button));
    render();
  }));
  $('#calcFields').addEventListener('input', updateAdditions);
  $('#costFields').addEventListener('input', updateCost);
  $('#costFields').addEventListener('change', updateCost);
  configureDialogs();
  updateAdditions();
  updateCost();
  render();
}

init();
