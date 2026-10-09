import { describe, expect, it } from 'vitest';
import {
  GuardError, assertRev, isSafeRefName, isSafeRemoteName, isSafeRemoteUrl, isSafeRev, normalizeRelPath,
} from '../src/git/argGuard';

describe('isSafeRefName', () => {
  it.each(['main', 'feature/ü-x', 'release/2.1', 'origin/feature/x', 'refs/heads/main', 'HEAD', 'v1.0.0'])('accepts %s', name => {
    expect(isSafeRefName(name)).toBe(true);
  });
  it.each(['', '-x', '--orphan', 'a..b', 'a b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', '/a', 'a/', 'a.', 'a//b', 'a.lock', 'a/.b', '@', 'a@{1}', 'a\nb', 'a\0b'])('rejects %j', name => {
    expect(isSafeRefName(name)).toBe(false);
  });
});

describe('isSafeRev', () => {
  it.each(['abc1234', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', 'main', 'main^', 'abc1234^3', 'HEAD~2', 'v1^{commit}', 'stash@{0}', 'origin/main'])('accepts %s', rev => {
    expect(isSafeRev(rev)).toBe(true);
  });
  it.each(['-p', '--all', 'main..dev', 'a b', 'stash@{x}', '', 'HEAD@{upstream}'])('rejects %j', rev => {
    expect(isSafeRev(rev)).toBe(false);
  });
});

describe('isSafeRemoteName / isSafeRemoteUrl', () => {
  it('accepts ordinary remotes and URLs', () => {
    expect(isSafeRemoteName('origin')).toBe(true);
    expect(isSafeRemoteName('up-stream')).toBe(true);
    expect(isSafeRemoteUrl('https://example.com/r.git')).toBe(true);
    expect(isSafeRemoteUrl('git@example.com:o/r.git')).toBe(true);
    expect(isSafeRemoteUrl('/srv/repos/r.git')).toBe(true);
  });
  it('rejects option-shaped values and dangerous transports', () => {
    expect(isSafeRemoteName('-origin')).toBe(false);
    expect(isSafeRemoteUrl('--upload-pack=touch x')).toBe(false);
    expect(isSafeRemoteUrl('ext::sh -c touch% /tmp/x')).toBe(false);
    expect(isSafeRemoteUrl('FD::3')).toBe(false);
    expect(isSafeRemoteUrl('https://a\nb')).toBe(false);
  });
});

describe('normalizeRelPath', () => {
  it('normalises relative paths', () => {
    expect(normalizeRelPath('src/a.ts')).toBe('src/a.ts');
    expect(normalizeRelPath('./src//a.ts')).toBe('src/a.ts');
    expect(normalizeRelPath('src/../b.ts')).toBe('b.ts');
    expect(normalizeRelPath('dir with space/ü.txt')).toBe('dir with space/ü.txt');
  });
  it.each(['', '/etc/passwd', 'C:/x', '../x', 'a/../../x', '.git/config', '.GIT/hooks/pre-commit', 'a\0b', '.'])('rejects %j', value => {
    expect(normalizeRelPath(value)).toBeNull();
  });
});

describe('assertRev', () => {
  it('throws a GuardError naming the field', () => {
    expect(() => assertRev('branch', '--orphan')).toThrow(GuardError);
    expect(() => assertRev('branch', '--orphan')).toThrow(/Invalid branch/);
    expect(assertRev('branch', 'main')).toBe('main');
  });
});

describe('normalizeRelPath with backslashes', () => {
  it.each(['..\\..\\evil.txt', 'a\\..\\..\\x', '.git\\hooks\\pre-commit', '.GIT\\config', 'src\\..\\..\\x'])('rejects traversal %j', value => {
    expect(normalizeRelPath(value)).toBeNull();
  });
  it('keeps a backslash that is part of a file name', () => {
    expect(normalizeRelPath('dir\\file.txt')).toBe('dir\\file.txt');
  });
});
