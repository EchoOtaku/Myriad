#!/usr/bin/env node
// Sync aro.ts template from runtime files
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const runtimeDir = path.join(root, 'backend/data/tapps/1/com.myriad.aro');
const templatePath = path.join(root, 'frontend/src/tapp/examples/tapps/aro.ts');

const html = fs.readFileSync(path.join(runtimeDir, 'page.html'), 'utf8');
const css = fs.readFileSync(path.join(runtimeDir, 'styles.css'), 'utf8');
const js = fs.readFileSync(path.join(runtimeDir, 'main.js'), 'utf8');

const existing = fs.readFileSync(templatePath, 'utf8');

// Extract header (imports before PAGE_HTML)
const headerEnd = existing.indexOf('const PAGE_HTML');
const header = existing.substring(0, headerEnd);

// Extract footer (manifest + export)
const manifestStart = existing.indexOf('// ==================== Manifest ====================');
let footer = existing.substring(manifestStart);

// Auto-sync manifest from manifest.json
const manifestJsonPath = path.join(runtimeDir, 'manifest.json');
if (fs.existsSync(manifestJsonPath)) {
  const mf = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf8'));
  // Build the permissions array string
  const permsStr = (mf.permissions || []).map(p => `    '${p}'`).join(',\n');
  // Build settings array string from manifest
  let settingsStr = '';
  if (mf.settings && mf.settings.length > 0) {
    const items = mf.settings.map(s => {
      const parts = [`key: '${s.key}'`, `type: '${s.type}'`];
      if (s.defaultValue !== undefined && s.defaultValue !== null) {
        parts.push(`defaultValue: ${JSON.stringify(s.defaultValue)}`);
      }
      if (s.label) parts.push(`label: '${s.label}'`);
      if (s.min !== undefined && s.min !== null) parts.push(`min: ${s.min}`);
      if (s.max !== undefined && s.max !== null) parts.push(`max: ${s.max}`);
      if (s.step !== undefined && s.step !== null) parts.push(`step: ${s.step}`);
      return `    { ${parts.join(', ')} }`;
    });
    settingsStr = items.join(',\n');
  }
  // Replace version
  footer = footer.replace(/version:\s*'[^']*'/, `version: '${mf.version || '1.0.0'}'`);
  // Replace permissions block
  footer = footer.replace(
    /permissions:\s*\[[\s\S]*?\]/,
    `permissions: [\n${permsStr},\n  ]`
  );
  // Replace settings block if present
  if (settingsStr && footer.includes('settings:')) {
    footer = footer.replace(
      /settings:\s*\[[\s\S]*?\]/,
      `settings: [\n${settingsStr},\n  ]`
    );
  }
}

// Escape backticks and ${ for template literals
function escTmpl(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const output = header
  + 'const PAGE_HTML = `\\\n' + escTmpl(html) + '`\n\n'
  + 'const STYLES = `\\\n' + escTmpl(css) + '`\n\n'
  + 'const CORE_CODE = `\\\n' + escTmpl(js) + '`\n\n'
  + footer;

fs.writeFileSync(templatePath, output, 'utf8');
console.log('aro.ts regenerated. Lines:', output.split('\n').length);
