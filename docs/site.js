'use strict';

const get = (id) => document.getElementById(id);
const make = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const themeButton = get('theme');
let chosenTheme;
try { chosenTheme = localStorage.getItem('mergeproof-theme'); } catch {}

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeButton.textContent = dark ? 'Light mode' : 'Dark mode';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#10192d' : '#f7f9fd';
}

applyTheme(chosenTheme || (systemTheme.matches ? 'dark' : 'light'));
themeButton.hidden = false;
themeButton.addEventListener('click', () => {
  chosenTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(chosenTheme);
  try { localStorage.setItem('mergeproof-theme', chosenTheme); } catch {}
});
systemTheme.addEventListener('change', (event) => {
  if (!chosenTheme) applyTheme(event.matches ? 'dark' : 'light');
});

const copyTimers = new WeakMap();
async function copyText(text, button, target) {
  const feedback = get('copy-feedback');
  try {
    await navigator.clipboard.writeText(text);
    feedback.textContent = 'Copied to clipboard.';
    const original = button.dataset.originalLabel || button.textContent;
    button.dataset.originalLabel = original;
    button.textContent = 'Copied';
    clearTimeout(copyTimers.get(button));
    copyTimers.set(button, setTimeout(() => { button.textContent = original; }, 1600));
  } catch {
    const selection = window.getSelection();
    if (target && selection) {
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
      feedback.textContent = 'Text selected. Use your keyboard to copy it.';
    } else {
      feedback.textContent = 'Clipboard access is unavailable.';
    }
  }
}

const systemCommands = {
  mac: 'brew install poppler',
  debian: 'sudo apt-get install poppler-utils',
  fedora: 'sudo dnf install poppler-utils',
};
const system = get('system');
get('system-control').hidden = false;
if (navigator.platform.toLowerCase().includes('linux')) system.value = 'debian';
function showSystemCommand() { get('system-command').textContent = systemCommands[system.value]; }
showSystemCommand();
system.addEventListener('change', showSystemCommand);
for (const button of document.querySelectorAll('[data-copy]')) {
  const target = get(button.dataset.copy);
  button.hidden = false;
  button.addEventListener('click', () => { void copyText(target.textContent, button, target); });
}

const demo = get('sample-content');
const sampleControls = get('sample-control');
const viewControls = get('view-control');
const copyOutput = get('copy-output');
let selectedSample = 'broken';
let selectedView = 'report';

function renderReport(result) {
  const summary = make('div', undefined, 'report-summary');
  const counts = [`${result.summary.pages} PDF pages`, `${result.summary.csvRows} source rows`,
    `${result.summary.verifiedRecords} verified`];
  for (const count of counts) summary.append(make('span', count));
  demo.append(summary);

  if (result.status === 'pass') {
    const success = make('article', undefined, 'success-report');
    success.append(make('h3', 'All source records verified'),
      make('p', 'The mapped text matches the CSV. Page 1 is a cover sheet and does not contain a record.'));
    demo.append(success);
    return;
  }

  const issue = result.fieldMismatches[0];
  const finding = make('article', undefined, 'finding');
  const header = make('div', undefined, 'finding-header');
  header.append(make('span', `Page ${issue.page} · Record ${issue.id}`), make('span', 'Field mismatch'));
  const values = make('div', undefined, 'values');
  for (const [label, value, style] of [
    ['Expected from CSV', issue.expected],
    ['Found on PDF', issue.extracted, 'incorrect'],
  ]) {
    const cell = make('div');
    cell.append(make('span', label), make('strong', value, style));
    values.append(cell);
  }
  finding.append(header, make('h3', issue.column), values);
  demo.append(finding, make('p', `${result.summary.findings - 1} more findings. Browse Terminal or JSON for the full report.`,
    'other-findings'));
}

function renderSample() {
  const sample = mergeproofSamples[selectedSample];
  const report = sample.report;
  const findings = report.summary.findings;
  const statusText = `${findings} ${findings === 1 ? 'finding' : 'findings'} · Exit ${report.exitCode}`;
  const status = get('sample-status');
  status.textContent = statusText;
  status.dataset.state = report.status;
  get('demo-announcement').textContent = statusText;
  demo.replaceChildren();
  copyOutput.hidden = selectedView === 'report';

  if (selectedView === 'report') {
    renderReport(report);
    return;
  }
  const panel = make('pre', undefined, 'output-text');
  panel.tabIndex = 0;
  panel.setAttribute('aria-label', selectedView === 'json' ? 'JSON output' : 'Terminal output');
  panel.append(make('code', selectedView === 'json' ? JSON.stringify(report, null, 2) : sample.terminal));
  demo.append(panel);
}

function selectChoice(group, field, onChange) {
  group.hidden = false;
  const buttons = [...group.querySelectorAll(`button[data-${field}]`)];
  for (const button of buttons) {
    button.addEventListener('click', () => {
      for (const option of buttons) option.setAttribute('aria-pressed', String(option === button));
      onChange(button.dataset[field]);
      renderSample();
    });
  }
}

if (typeof mergeproofSamples !== 'undefined') {
  selectChoice(sampleControls, 'sample', (value) => { selectedSample = value; });
  selectChoice(viewControls, 'view', (value) => { selectedView = value; });
  copyOutput.addEventListener('click', () => {
    const target = demo.querySelector('code');
    if (target) void copyText(target.textContent, copyOutput, target);
  });
  renderSample();
}
