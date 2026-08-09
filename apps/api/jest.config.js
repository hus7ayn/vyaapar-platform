module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  // .vercel/output holds a built copy of packages/shared; without this jest sees two packages
  // claiming the name @nexus/shared and refuses to resolve either.
  modulePathIgnorePatterns: ['<rootDir>/.vercel/'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@nexus/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
};
