export default {
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: 'test/tsconfig.json' }]
  },
  moduleNameMapper: {
    // Strip .js extensions so ts-jest can resolve TypeScript source files
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  moduleFileExtensions: ['ts', 'js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', 'src/**/*.js'],
  testMatch: ['**/*.spec.(ts)'],
  testEnvironment: 'node'
}
