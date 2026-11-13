import { readFileSync } from 'node:fs';

const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = text => escape(text)
  .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/`([^`]+)`/g, '<code>$1</code>');

/** Read-only, escaped reader for this sample's small Markdown setup subset. */
export function setupPage() {
  const source = readFileSync(new URL('./README.md', import.meta.url), 'utf8')
    .split('## Setup\n')[1].split('\n## Recovery')[0];
  let fenced = false;
  const body = source.split('\n').map(line => {
    if (line.trim().startsWith('```')) {
      fenced = !fenced;
      return fenced ? '<pre><code>' : '</code></pre>';
    }
    if (fenced) return escape(line);
    if (line.trim().startsWith('|')) {
      const cells = line.trim().split('|').slice(1, -1).map(cell => cell.trim());
      if (['Name', 'Variable'].includes(cells[0]) || /^-+$/.test(cells[0])) return '';
      return `<p><strong>${inline(cells[0])}</strong>: ${inline(cells[1] ?? '')}</p>`;
    }
    const step = line.match(/^(\d+)\. \*\*(.+?)\*\*\s*(.*)$/);
    if (step) return `<h2>${step[1]}. ${inline(step[2])}</h2><p>${inline(step[3])}</p>`;
    return line.trim() ? `<p>${inline(line.trim())}</p>` : '';
  }).join('\n');
  return `<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AI sample setup</title>
    <style>body{max-width:760px;margin:auto;padding:24px;font:16px/1.7 system-ui;color:#23314c}h1{line-height:1.2}h2{font-size:21px;margin-top:32px}pre{padding:16px;background:#f3f1fb;white-space:pre-wrap}code{overflow-wrap:anywhere}a{color:#5140b6}</style>
    <body><a href="./">Back to sample</a><h1 id="setup">Connect your already deployed app</h1>
    <p>Manual setup · development/test only. Obtain resource-owner approval before cloud actions.</p>${body}
    <p><a href="https://github.com/AzureAppService/app-service-builder-ai-agent">Full README, recovery and optional local details (upstream)</a></p></body></html>`;
}
