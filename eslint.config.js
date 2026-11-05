import nx from '@nx/eslint-plugin';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '.nx/**'] },
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/*.mts'],
    rules: {
      '@nx/enforce-module-boundaries': ['error', {
        depConstraints: [
          { sourceTag: 'layer:adk', onlyDependOnLibsWithTags: ['layer:adk', 'layer:provider'] },
          { sourceTag: 'layer:provider', onlyDependOnLibsWithTags: ['layer:provider'] },
          { sourceTag: 'layer:session', onlyDependOnLibsWithTags: ['layer:session', 'layer:adk'] },
          { sourceTag: 'layer:coding', onlyDependOnLibsWithTags: ['layer:coding', 'layer:adk', 'layer:provider', 'layer:session'] },
          { sourceTag: 'layer:app', onlyDependOnLibsWithTags: ['layer:adk', 'layer:provider', 'layer:session', 'layer:coding'] }
        ]
      }]
    }
  },
  {
    files: ['packages/coding-agent/src/**/*.ts'],
    ignores: ['packages/coding-agent/src/node/**'],
    rules: { 'no-restricted-imports': ['error', { paths: [{ name: '@alpha/provider', allowTypeImports: true }], patterns: [{ group: ['node:*', 'bun:*', '@alpha/adk-session', '@alpha/adk-session/**', './node/**', '../node/**', '@alpha/adk/src/**', '@alpha/provider/*'] }] }] }
  },
  {
    files: ['packages/adk-session/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [{ name: '@alpha/adk/core', allowTypeImports: true }, { name: '@alpha/adk' }], patterns: [{ group: ['@alpha/adk/*', '!@alpha/adk/core', '@alpha/adk/src/**', '@alpha/provider', '@alpha/provider/**'] }] }] }
  },
  {
    files: ['packages/adk-session/src/**/*.ts'],
    ignores: ['packages/adk-session/src/sqlite/**'],
    rules: { 'no-restricted-imports': ['error', { paths: [{ name: '@alpha/adk/core', allowTypeImports: true }, { name: '@alpha/adk' }], patterns: [{ group: ['@alpha/adk/*', '!@alpha/adk/core', '@alpha/adk/src/**', '@alpha/provider', '@alpha/provider/**', 'better-sqlite3', 'bun:*', '../sqlite/**', './sqlite/**'] }] }] }
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
