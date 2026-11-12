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
          { sourceTag: 'layer:trace', onlyDependOnLibsWithTags: ['layer:trace', 'layer:adk'] },
          { sourceTag: 'layer:coding', onlyDependOnLibsWithTags: ['layer:coding', 'layer:adk', 'layer:provider', 'layer:session'] },
          { sourceTag: 'layer:app', onlyDependOnLibsWithTags: ['layer:adk', 'layer:provider', 'layer:session', 'layer:coding', 'layer:trace'] },
          { sourceTag: 'layer:alphacode-cli', onlyDependOnLibsWithTags: ['layer:app-server', 'layer:provider', 'layer:session'] },
          { sourceTag: 'layer:app-server', onlyDependOnLibsWithTags: ['layer:adk', 'layer:provider', 'layer:session', 'layer:coding', 'layer:trace'] },
          { sourceTag: 'layer:web', onlyDependOnLibsWithTags: ['layer:trace'] }
        ]
      }]
    }
  },
  {
    files: ['apps/alphacode/src/**/*.ts', 'apps/alphacode/src/**/*.tsx'],
    rules: { 'no-restricted-syntax': ['error', {
      selector: String.raw`:matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression, TSImportType) > Literal.source[value=/^[.]{1,2}\u002F.*[.][cm]?[jt]sx?$/]`,
      message: 'Omit code file extensions in relative import/export paths.'
    }, {
      selector: String.raw`:matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression, TSImportType) > Literal.source[value=/^@alpha\u002Falphacode-app-server($|\u002Ftesting$)/]`,
      message: 'Production clients connect to the AlphaCode service; business factories are only for integration tests.'
    }] }
  },
  {
    files: ['apps/alphacode-web/src/**/*.ts', 'apps/alphacode-web/src/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: '@alpha/adk-trace' }, { name: '@alpha/adk-trace/contracts', allowTypeImports: true }], patterns: [{
        group: ['@alpha/**', '!@alpha/adk-trace', '@alpha/adk-trace/**', '!@alpha/adk-trace/contracts', '@opentui/**', 'bun', 'bun:*', 'node:*', '**/alphacode/src/**'],
        message: 'Keep the browser independent of CLI and server internals.'
      }] }]
    }
  },
  {
    files: ['packages/adk-trace/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [{ name: '@alpha/adk' }, { name: '@alpha/adk/core', allowTypeImports: true }], patterns: [{ group: ['@alpha/adk/*', '!@alpha/adk/core', '@alpha/adk/src/**', '@alpha/adk-session', '@alpha/adk-session/**', '@alpha/provider', '@alpha/provider/**'] }] }] }
  },
  {
    files: ['packages/adk-trace/src/**/*.ts'],
    ignores: ['packages/adk-trace/src/sqlite/**'],
    rules: { 'no-restricted-imports': ['error', { paths: [{ name: '@alpha/adk' }, { name: '@alpha/adk/core', allowTypeImports: true }], patterns: [{ group: ['@alpha/adk/*', '!@alpha/adk/core', '@alpha/adk/src/**', '@alpha/adk-session', '@alpha/adk-session/**', '@alpha/provider', '@alpha/provider/**', 'bun:*', 'node:*', './sqlite/**', '../sqlite/**'] }] }] }
  },
  {
    files: ['apps/alphacode-app-server/src/chat/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['i18next', 'react-i18next', '**/i18n/instance', '**/i18n/bootstrap', '@alpha/**', '@opentui/**', 'react', 'react/**', 'react-dom', 'react-dom/**', 'bun:*', 'node:fs', 'node:fs/**', '**/runtime/**', '**/ui/**', '**/application', '**/config'],
        message: 'Chat depends on its contracts; inject runtime capabilities from application.ts.'
      }] }]
    }
  },
  {
    files: ['apps/alphacode/src/ui/**/*.ts', 'apps/alphacode/src/ui/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: '@alpha/alphacode-app-server' }, { name: '@alpha/alphacode-app-server/contracts', allowTypeImports: true }], patterns: [{
        group: ['@alpha/**', '!@alpha/alphacode-app-server', '@alpha/alphacode-app-server/**', '!@alpha/alphacode-app-server/contracts', 'bun:*', '**/runtime/**', '**/application', '**/config', '**/chat/controller', '**/chat/approval', '**/chat/messages'],
        message: 'UI consumes Chat contracts and callbacks; keep runtime and controller implementations outside components.'
      }] }]
    }
  },
  {
    files: ['apps/alphacode-app-server/src/runtime/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: ['i18next', 'react-i18next', '**/i18n/instance', '**/i18n/bootstrap', '@opentui/**', 'react', 'react/**', 'react-dom', 'react-dom/**', '**/ui/**', '**/application', '**/chat/controller', '**/chat/approval', '**/chat/messages'],
        message: 'Runtime implements Chat contracts; application.ts owns controller and UI composition.'
      }] }]
    }
  },
  {
    files: ['apps/alphacode-app-server/src/server/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{
      group: ['i18next', 'react-i18next', '**/i18n/instance', '**/i18n/bootstrap', '**/i18n/presentation'],
      message: 'The server publishes language-independent state; clients translate it.'
    }] }] }
  },
  {
    files: ['apps/alphacode-app-server/src/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', {
      selector: String.raw`:matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression, TSImportType) > Literal.source[value=/^[.]{1,2}\u002F.*[.][cm]?[jt]sx?$/]`,
      message: 'Omit code file extensions in relative import/export paths.'
    }, {
      selector: String.raw`:matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression, TSImportType) > Literal.source[value=/(^react($|\/)|^react-dom($|\/)|^@opentui\/|^i18next$|^react-i18next$|^@alpha\/alphacode$|apps\/|\/ui\/|\/i18n\/)/]`,
      message: 'App server must run independently of terminal and browser UI.'
    }] }
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
