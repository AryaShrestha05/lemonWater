import { describe, expect, test } from 'vitest'
import { analyzeProject } from '../../src/core/analyzeProject'
import { fileSummary, folderSummary } from '../../src/core/summarize'
import { makeFixture } from '../helpers/fixture'

const fanIn = Object.fromEntries(
  Array.from({ length: 6 }, (_, i) => [`src/user${i}.ts`, `import { fmt } from './util'\nfmt()`])
)

const g = analyzeProject(
  makeFixture({
    'src/main.tsx': "import App from './App'\nconst x = <App />",
    'src/App.tsx':
      "import { fetchUser } from './lib/api'\nimport { save } from './lib/db'\nexport default function App() { fetchUser(); save(); return <div /> }",
    'src/lib/api.ts': 'export function fetchUser() {}\nexport function fetchAll() {}',
    'src/lib/db.ts': '// Talks to the database.\n\nexport function save() {}',
    'src/util.ts': 'export function fmt() {}',
    ...fanIn,
    'src/lonely.ts': 'const a = 1',
    'tests/api.test.ts': "import { fetchUser } from '../src/lib/api'\nfetchUser()",
    'vite.config.ts': 'export default {}'
  })
)

describe('fileSummary', () => {
  test("uses the author's header comment when there is one", () => {
    expect(fileSummary(g, 'src/lib/db.ts')).toBe('Talks to the database.')
  })

  test('React component with its connections', () => {
    expect(fileSummary(g, 'src/App.tsx')).toBe(
      'React component App · uses 2 files · used by main.tsx'
    )
  })

  test('definitions plus who uses them', () => {
    expect(fileSummary(g, 'src/lib/api.ts')).toBe(
      'Defines fetchUser, fetchAll · used by App.tsx +1'
    )
  })

  test('starting point when nothing imports it', () => {
    expect(fileSummary(g, 'src/main.tsx')).toBe(
      'Starting point: no other file uses it · uses 1 file'
    )
  })

  test('shared building block when many files use it', () => {
    expect(fileSummary(g, 'src/util.ts')).toBe(
      'Defines fmt · shared building block: used by 6 files'
    )
  })

  test('test files name what they test', () => {
    expect(fileSummary(g, 'tests/api.test.ts')).toBe('Tests for api.ts')
  })

  test('config files', () => {
    expect(fileSummary(g, 'vite.config.ts')).toBe('Tool config file')
  })

  test('unconnected files', () => {
    expect(fileSummary(g, 'src/lonely.ts')).toBe('Not connected to other files')
  })
})

describe('folderSummary', () => {
  test('counts files and names the folders it works with', () => {
    expect(folderSummary(g, 'src/lib')).toBe('2 files · works with src/, tests/')
  })

  test('mostly components / mostly tests', () => {
    const h = analyzeProject(
      makeFixture({
        'ui/A.tsx': 'export function A() { return <div /> }',
        'ui/B.tsx': 'export function B() { return <div /> }',
        'ui/c.ts': 'export const c = 1',
        't/a.test.ts': '',
        't/b.test.ts': ''
      })
    )
    expect(folderSummary(h, 'ui')).toBe('3 files, mostly React components')
    expect(folderSummary(h, 't')).toBe('2 files, mostly tests')
  })

  test('the root folder', () => {
    expect(folderSummary(g, '.')).toMatch(/^Project root · \d+ files$/)
  })
})
