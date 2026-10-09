import { describe, expect, it } from 'vitest';
import { buildCss, buildLanguageMap, normalizeAssociations, parseJsonc } from '../src/panel/iconThemeModel';

describe('parseJsonc', () => {
  it('strips comments and trailing commas outside strings', () => {
    expect(parseJsonc('{ // c\n "a": "x//y", /* b */ "b": [1, 2,], }')).toEqual({ a: 'x//y', b: [1, 2] });
  });
});

describe('buildCss', () => {
  const doc = {
    fonts: [{ id: 'seti', src: [{ path: './seti.woff', format: 'woff' }], weight: 'normal', style: 'normal', size: '150%' }],
    iconDefinitions: {
      _ts: { fontCharacter: '\\E01A', fontColor: '#519aba' },
      _svg: { iconPath: './icons/a.svg' },
      _bad: { fontCharacter: '"; } body { display: none', fontColor: 'red;}' },
    },
  };

  it('emits font faces and one class per safe definition', () => {
    const { css, classes } = buildCss(doc, '/themes/seti', abs => `https://res${abs}`);
    expect(css).toContain('@font-face { font-family: "mygit-fi-0"; src: url("https://res/themes/seti/seti.woff") format("woff")');
    expect(css).toContain(`.${classes._ts}::before { content: "\\E01A"; font-family: "mygit-fi-0"; color: #519aba; font-size: 150%; }`);
    expect(css).toContain(`.${classes._svg} { background: center / contain no-repeat url("https://res/themes/seti/icons/a.svg"); }`);
    expect(classes._bad).toBeUndefined();
    expect(css).not.toContain('display: none');
  });
});

describe('normalizeAssociations', () => {
  it('lowercases name and extension keys', () => {
    expect(normalizeAssociations({ file: '_f', fileNames: { Dockerfile: '_d' }, fileExtensions: { TS: '_ts' }, languageIds: { typescript: '_ts' } }))
      .toEqual({ file: '_f', fileNames: { dockerfile: '_d' }, fileExtensions: { ts: '_ts' }, languageIds: { typescript: '_ts' } });
  });
});

describe('buildLanguageMap', () => {
  it('maps extensions and file names to language ids', () => {
    expect(buildLanguageMap([{ id: 'typescript', extensions: ['.ts', '.MTS'] }, { id: 'dockerfile', filenames: ['Dockerfile'] }, { id: 7 }]))
      .toEqual({ extensions: { ts: 'typescript', mts: 'typescript' }, filenames: { dockerfile: 'dockerfile' } });
  });
});
