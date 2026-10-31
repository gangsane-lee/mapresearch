// REST 클라이언트. 에러 응답 { error: { code, message } } → ApiError
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let token = null;
try {
  token = localStorage.getItem('aptlog.apiToken');
} catch {
  token = null;
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', '서버에 연결할 수 없습니다');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'HTTP_' + res.status, data?.error?.message ?? res.statusText);
  }
  return data;
}

/** multipart 업로드 (Content-Type 은 브라우저가 boundary 포함해 설정) */
export async function upload(path, formData) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(path, { method: 'POST', headers, body: formData });
  const data = await res.json().catch(() => null);
  if (!res.ok && !data?.items) throw new ApiError(res.status, data?.error?.code ?? 'HTTP_' + res.status, data?.error?.message ?? res.statusText);
  return data;
}

/** 이미지 src: 토큰 모드(LAN 접속)에서는 <img>가 헤더를 못 보내므로 blob URL로 받는다 */
export async function mediaSrc(url) {
  if (!token) return url;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ApiError(res.status, 'MEDIA', '이미지를 불러올 수 없습니다');
  return URL.createObjectURL(await res.blob());
}

/** 정적 파일(geo 등) */
export async function getStatic(path) {
  const res = await fetch(path);
  if (!res.ok) throw new ApiError(res.status, 'STATIC_' + res.status, `${path} 를 불러올 수 없습니다`);
  return res.json();
}
