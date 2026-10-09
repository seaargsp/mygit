import type { RemoteInfo } from './refs';

const SECRET_PARAMS = new Set(['token', 'password', 'access_token', 'auth', 'private_token']);

function paramName(pair: string): string {
  const name = pair.split('=')[0];
  try {
    return decodeURIComponent(name).toLowerCase();
  } catch {
    return name.toLowerCase();
  }
}

/** http(s) URL without userinfo and without secret query parameters; other forms unchanged. */
export function redactUrl(url: string): string {
  const match = /^(https?):\/\/([^/?#]*)(.*)$/is.exec(url);
  if (!match) return url;
  const [, scheme, authority, rest] = match;
  const host = authority.slice(authority.lastIndexOf('@') + 1);
  let tail = rest;
  const queryAt = rest.indexOf('?');
  if (queryAt !== -1) {
    const hashAt = rest.indexOf('#', queryAt);
    const query = rest.slice(queryAt + 1, hashAt === -1 ? undefined : hashAt);
    const kept = query.split('&').filter(pair => pair && !SECRET_PARAMS.has(paramName(pair)));
    tail = `${rest.slice(0, queryAt)}${kept.length > 0 ? `?${kept.join('&')}` : ''}${hashAt === -1 ? '' : rest.slice(hashAt)}`;
  }
  return `${scheme}://${host}${tail}`;
}

export function redactText(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s'"<>]+/gi, url => redactUrl(url));
}

export function redactRemote(remote: RemoteInfo): RemoteInfo {
  const fetchUrl = redactUrl(remote.fetchUrl);
  const pushUrl = redactUrl(remote.pushUrl);
  return { ...remote, fetchUrl, pushUrl, redacted: fetchUrl !== remote.fetchUrl || pushUrl !== remote.pushUrl };
}
