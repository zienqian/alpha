import nx from '@nx/eslint-plugin';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '.nx/**'] },
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  {
    files: ['**/*.ts', '**/*.js', '**/*.mjs', '**/*.mts'],
    rules: {
      '@nx/enforce-module-boundaries': ['error', {
        depConstraints: [
          { sourceTag: 'layer:adk', onlyDependOnLibsWithTags: ['layer:adk'] },
          { sourceTag: 'layer:provider', onlyDependOnLibsWithTags: ['layer:provider'] },
          { sourceTag: 'layer:app', onlyDependOnLibsWithTags: ['layer:adk', 'layer:provider'] }
        ]
      }]
    }
  }
];
