import nx from '@nx/eslint-plugin';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '.nx/**'] },
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.mts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: String.raw`:matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression, TSImportType) > Literal.source[value=/^[.]{1,2}\u002F.*[.][cm]?[jt]sx?$/]`,
        message: 'Omit code file extensions in relative import/export paths.'
      }],
      '@nx/enforce-module-boundaries': ['error', {
        depConstraints: [
          { sourceTag: 'layer:adk', onlyDependOnLibsWithTags: ['layer:adk', 'layer:provider'] },
          { sourceTag: 'layer:provider', onlyDependOnLibsWithTags: ['layer:provider'] },
          { sourceTag: 'layer:session', onlyDependOnLibsWithTags: ['layer:session', 'layer:adk'] },
          { sourceTag: 'layer:coding', onlyDependOnLibsWithTags: ['layer:coding', 'layer:adk', 'layer:provider', 'layer:session'] },
          { sourceTag: 'layer:app', onlyDependOnLibsWithTags: ['layer:adk', 'layer:provider', 'layer:session', 'layer:coding'] },
          { sourceTag: 'layer:web', onlyDependOnLibsWithTags: [] }
        ]
      }]
    }
  },
  {
    files: ['apps/alphacode-web/src/**/*.ts', 'apps/alphacode-web/src/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['@alpha/**', '@opentui/**', 'bun', 'bun:*', 'node:*', '**/alphacode/src/**'],
        message: 'Keep the browser independent of CLI and server internals.'
      }] }]
    }
  },
  {
    files: ['apps/alphacode/src/chat/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['@alpha/**', '@opentui/**', 'react', 'react/**', 'react-dom', 'react-dom/**', 'bun:*', 'node:fs', 'node:fs/**', '**/runtime/**', '**/ui/**', '**/application', '**/config'],
        message: 'Chat depends on its contracts; inject runtime capabilities from application.ts.'
      }] }]
    }
  },
  {
    files: ['apps/alphacode/src/ui/**/*.ts', 'apps/alphacode/src/ui/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['@alpha/**', 'bun:*', '**/runtime/**', '**/application', '**/config', '**/chat/controller', '**/chat/approval', '**/chat/messages'],
        message: 'UI consumes Chat contracts and callbacks; keep runtime and controller implementations outside components.'
      }] }]
    }
  },
  {
    files: ['apps/alphacode/src/runtime/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['@opentui/**', 'react', 'react/**', 'react-dom', 'react-dom/**', '**/ui/**', '**/application', '**/chat/controller', '**/chat/approval', '**/chat/messages'],
        message: 'Runtime implements Chat contracts; application.ts owns controller and UI composition.'
      }] }]
    }
  },
  {
    files: ['packages/coding-agent/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [{ name: '@alpha/provider', allowTypeImports: true }], patterns: [{ group: ['@alpha/adk-session', '@alpha/adk-session/**', '@alpha/adk/src/**', '@alpha/provider/*'] }] }] }
  },
  {
    files: ['packages/adk-session/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [{ name: '@alpha/adk/core', allowTypeImports: true }, { name: '@alpha/adk' }], patterns: [{ group: ['@alpha/adk/*', '!@alpha/adk/core', '@alpha/adk/src/**', '@alpha/provider', '@alpha/provider/**'] }] }] }
  },
  {
    files: ['packages/adk-session/src/**/*.ts'],
    ignores: ['packages/adk-session/src/sqlite/**'],
    rules: { 'no-restricted-imports': ['error', { paths: [{ name: '@alpha/adk/core', allowTypeImports: true }, { name: '@alpha/adk' }], patterns: [{ group: ['@alpha/adk/*', '!@alpha/adk/core', '@alpha/adk/src/**', '@alpha/provider', '@alpha/provider/**', 'bun:*', '../sqlite/**', './sqlite/**'] }] }] }
  },
  {
    files: ['packages/adk/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@alpha/provider', allowTypeImports: true, message: 'ADK only imports Provider types.' },
          { name: '@standard-schema/spec', allowTypeImports: true, message: 'Schema protocols are type-only dependencies.' }],
        patterns: [{ group: ['@alpha/provider/*', 'zod', 'zod/*', '@anthropic-ai/*', 'openai', '@ai-sdk/*'], message: 'Keep adapters and schema implementations outside the kernel.' }]
      }]
    }
  }
];
