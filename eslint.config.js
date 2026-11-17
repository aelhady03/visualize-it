// ESLint flat config. Owned by the integrator — lane/module workers must NOT
// edit this file (see AGENTS.md "Shared-file ownership").
//
// Module isolation (PLAN.md §3.6) is written entirely with globs, so adding a
// new module under src/modules/<id>/ never requires touching this file.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import boundaries from 'eslint-plugin-boundaries'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const TEST_FILES = ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**']

// --- Classification ----------------------------------------------------------
// Elements are FOLDERS (one per area / per module). The first matching
// descriptor wins at each path level, so the most specific come first.
const elements = [
  { type: 'core', pattern: 'src/core', partialMatch: false },
  { type: 'shell', pattern: 'src/shell', partialMatch: false },
  { type: 'module', pattern: 'src/modules/*', capture: ['module'], partialMatch: false },
  // App entry, routes, pages: src/main.tsx, src/App.tsx, src/pages/**, ...
  { type: 'app', pattern: 'src', partialMatch: false },
]

// Files get categories on top of their element (a file may have several).
const files = [
  { pattern: 'src/**', category: 'src' }, // catch-all, so `categories` is never null
  { pattern: 'src/core/engine-contract.ts', category: 'engine-contract' },
  // Pure simulation code of a module (PLAN.md §8 "Engine purity").
  {
    pattern: ['src/modules/*/engine/**', 'src/modules/*/lib/**', 'src/modules/*/state.ts'],
    category: 'pure',
  },
]

// --- Selectors -----------------------------------------------------------------
const toExternal = { to: { module: { origin: ['external', 'core'] } } } // npm packages + node builtins
const toCore = { to: { element: { types: 'core' } } }
const toEngineContract = { to: { file: { categories: 'engine-contract' } } }
const toShell = { to: { element: { types: 'shell' } } }
const toApp = { to: { element: { types: 'app' } } }
// Same module only: the captured folder name must match the importer's.
const SAME_MODULE = { types: 'module', captured: { module: '{{ from.element.captured.module }}' } }
const toSameModule = { to: { element: SAME_MODULE } }
const toSameModulePure = { to: { element: SAME_MODULE, file: { categories: 'pure' } } }

const notPure = { categories: { noneOf: ['pure'] } }

// --- Policies ------------------------------------------------------------------
// default: disallow; when several policies match, the LAST one decides.
// Anything not explicitly allowed below is an error.
const productionPolicies = [
  // src/core may import only src/core and npm packages (never @shell or a module)
  {
    from: { element: { types: 'core' } },
    allow: [toCore, toExternal],
  },
  // src/shell may import only @core/*, @shell/* and npm packages — never a module (modules are discovered via import.meta.glob)
  {
    from: { element: { types: 'shell' } },
    allow: [toCore, toShell, toExternal],
  },
  // app code may not import a module directly (modules are discovered via import.meta.glob)
  {
    from: { element: { types: 'app' } },
    allow: [toCore, toShell, toApp, toExternal],
  },
  // modules may import only @core/*, their own files and npm packages — never @shell or another module
  {
    from: { element: { types: 'module' }, file: notPure },
    allow: [toCore, toSameModule, toExternal],
  },
  // engine/**, lib/** and state.ts may import only @core/engine-contract and their own module's engine/lib/state — no React, no npm packages, no other module
  {
    from: { element: { types: 'module' }, file: { categories: 'pure' } },
    allow: [toEngineContract, toSameModulePure],
  },
]

// Tests: the same isolation between areas, but any npm package (vitest,
// fast-check, testing-library, React) and the whole own module are allowed.
const testPolicies = [
  ...productionPolicies.slice(0, 3),
  // module tests may import only @core/*, their own module and npm packages
  {
    from: { element: { types: 'module' } },
    allow: [toCore, toSameModule, toExternal],
  },
]

const boundariesRules = (policies) => ({
  'boundaries/dependencies': [
    'error',
    { default: 'disallow', checkAllOrigins: true, checkInternals: true, policies },
  ],
})

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': elements,
      'boundaries/files': files,
      'boundaries/include': ['src/**/*'],
      'boundaries/legacy-templates': false,
      'import/resolver': {
        typescript: { project: './tsconfig.app.json', alwaysTryTypes: true },
      },
    },
    rules: boundariesRules(productionPolicies),
  },
  {
    files: TEST_FILES,
    rules: boundariesRules(testPolicies),
  },
])
