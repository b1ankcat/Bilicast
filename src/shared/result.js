export function ok(payload = {}) {
  return { ok: true, ...payload };
}

export function fail(message, payload = {}) {
  return { ok: false, message, ...payload };
}

export function isFailure(result) {
  return result?.ok === false;
}

export function messageFromError(error, fallback) {
  if (typeof error === "string") {
    return error;
  }
  return error?.message || fallback;
}
