import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Structural guards for the browser modules.
//
// Why these exist: on 2026-07-26 an edit to app.js deleted ~20 methods — the
// whole MMS preview/confirmation/completion UI — while leaving their call sites
// intact. `node --check` passed, because the result was still valid JavaScript,
// and no unit test covered app.js. The break would only have surfaced when a
// tutor tried to finish a lesson.
//
// These two checks catch that class of damage without a DOM, a browser, or a
// dependency: a method that is called must exist, and an imported name must be
// exported. Both are the kind of thing a human reviewer reads straight past.

const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'src');

const sourceFiles = readdirSync(SRC_DIR).filter((name) => name.endsWith('.js'));

function read(file) {
  return readFileSync(path.join(SRC_DIR, file), 'utf8');
}

// Class methods sit at four-space indent: `  methodName(args) {` / `async name(`.
function definedMethods(source) {
  return new Set(
    [...source.matchAll(/^ {4}(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/gm)].map((m) => m[1])
  );
}

// Function-valued properties are callable too. asr-client assigns callbacks
// (`this.onError = null`) in the constructor and invokes them as `this.onError(…)`,
// which is a definition even though it is not a method.
function assignedProperties(source) {
  return new Set(
    [...source.matchAll(/this\.([a-zA-Z_$][\w$]*)\s*=/g)].map((m) => m[1])
  );
}

// Calls through `this`. `this.foo.bar()` is excluded by requiring the paren to
// follow the identifier directly, so only own-method calls are collected.
function calledMethods(source) {
  return new Set(
    [...source.matchAll(/this\.([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1])
  );
}

function exportedNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([a-zA-Z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  // `export { a, b as c }`
  for (const block of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const entry of block[1].split(',')) {
      const alias = entry.split(/\sas\s/).pop().trim();
      if (alias) names.add(alias);
    }
  }
  return names;
}

// `import { a, b as c } from './mod.js?v=stamp'` — the cache-busting query is
// part of how this app ships, so it must be stripped before resolving.
function namedImports(source) {
  const imports = [];
  for (const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = m[1]
      .split(',')
      .map((entry) => entry.split(/\sas\s/)[0].trim())
      .filter(Boolean);
    imports.push({ names, specifier: m[2] });
  }
  return imports;
}

test('every method called on `this` is defined in the same module', () => {
  for (const file of sourceFiles) {
    const source = read(file);
    const defined = definedMethods(source);
    const assigned = assignedProperties(source);
    const called = calledMethods(source);

    const missing = [...called].filter((name) => !defined.has(name) && !assigned.has(name));

    assert.deepEqual(
      missing,
      [],
      `${file} calls method(s) it does not define: ${missing.join(', ')}. `
      + 'Either the method was deleted while its call sites survived, or the name is a typo.'
    );
  }
});

test('every imported name is actually exported by its source module', () => {
  for (const file of sourceFiles) {
    const source = read(file);

    for (const { names, specifier } of namedImports(source)) {
      if (!specifier.startsWith('.')) continue;

      const targetName = path.basename(specifier.split('?')[0]);
      assert.ok(
        sourceFiles.includes(targetName),
        `${file} imports from '${specifier}', which is not a module in public/src`
      );

      const exported = exportedNames(read(targetName));
      const missing = names.filter((name) => !exported.has(name));

      assert.deepEqual(
        missing,
        [],
        `${file} imports ${missing.join(', ')} from '${specifier}', but that module does not export it. `
        + 'The browser fails the whole module graph on this — the app would not start at all.'
      );
    }
  }
});

test('app.js still defines the methods the lesson-finishing flow depends on', () => {
  // A deliberate golden list, not a generated one. These are the methods whose
  // silent loss would break finishing a lesson without breaking page load —
  // exactly what happened. Adding to this list should be a conscious act.
  const CRITICAL = [
    'startRecording', 'stopRecording', 'processCurrentAnswer',
    'finishRecording', 'generateStructuredOutput', 'getCurrentNoteText',
    'previewMmsTestWrite', 'executeMmsTestWrite', 'renderMmsPreview',
    'confirmLessonFinish', 'confirmNoteSafety',
    'renderMmsCompletion', 'renderMmsAlreadyCompleted', 'renderMmsInProgress',
    'renderMmsPartialCompletion', 'renderMmsLogWarning', 'renderMmsSavingState',
    'notifyDashboardPracticeChatComplete', 'saveDashboardSnapshotForCurrentNote',
    'copyToClipboard', 'takeAttendance', 'startTypedNotes', 'escapeHtml',
  ];

  const defined = definedMethods(read('app.js'));
  const missing = CRITICAL.filter((name) => !defined.has(name));

  assert.deepEqual(missing, [], `app.js is missing critical method(s): ${missing.join(', ')}`);
});

test('the cache-bust stamp is consistent across app, index.html and the service worker', () => {
  // A stale stamp means tutors keep running the old bundle for up to a day —
  // the fix ships but nobody receives it.
  const app = read('app.js');
  const build = app.match(/const PRACTICE_CHAT_BUILD = '([^']+)'/)?.[1];
  assert.ok(build, 'app.js has no PRACTICE_CHAT_BUILD stamp');

  const publicDir = path.join(SRC_DIR, '..');
  const indexHtml = readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  assert.ok(
    indexHtml.includes(`/src/app.js?v=${build}`),
    `index.html loads app.js with a different stamp than PRACTICE_CHAT_BUILD ('${build}')`
  );

  for (const { specifier } of namedImports(app)) {
    if (!specifier.startsWith('.') || !specifier.includes('?v=')) continue;
    const stamp = specifier.split('?v=')[1];
    assert.equal(
      stamp,
      build,
      `app.js imports '${specifier}' with a stamp that does not match PRACTICE_CHAT_BUILD ('${build}')`
    );
  }
});
