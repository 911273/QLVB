// Đồng bộ danh sách buổi học lên Google Calendar qua REST API (dùng access token).
// Dùng id sự kiện ổn định (suy từ nội dung) để đồng bộ lại KHÔNG tạo trùng.

const TZ = 'Asia/Ho_Chi_Minh';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// Hash -> chuỗi base32hex hợp lệ cho event id (chỉ dùng 0-9 a-v).
function eventId(s) {
  const raw = `${s.date}|${s.p1}|${s.p2}|${s.class}|${s.course}|${s.room}`;
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 * 31 + c) >>> 0;
  }
  const toB32 = (n) => (n >>> 0).toString(32); // ký tự 0-9 a-v
  return 'tkb' + toB32(h1) + toB32(h2);
}

function eventBody(s) {
  return {
    id: eventId(s),
    summary: s.lessonShort ? `${s.subject} — ${s.lessonShort}` : s.subject,
    description: s.lesson || undefined,
    location: s.room,
    start: { dateTime: `${s.date}T${s.startTime}:00`, timeZone: TZ },
    end: { dateTime: `${s.date}T${s.endTime}:00`, timeZone: TZ },
    source: { title: 'TKB (vupq-hub)', url: 'https://vupq-hub.web.app' },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gọi API có tự động thử lại khi bị giới hạn tốc độ (403 rateLimitExceeded /
// 429 / 5xx) với exponential backoff. 403 do thiếu quyền thì KHÔNG thử lại.
async function apiFetch(url, opts, maxRetries = 6) {
  let delay = 800;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, opts);
    if (res.ok || res.status === 409) return res;

    let retriable = res.status === 429 || res.status >= 500;
    if (res.status === 403) {
      const body = await res.clone().text().catch(() => '');
      retriable = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|backendError/i.test(body);
    }
    if (retriable && attempt < maxRetries) {
      await sleep(delay + Math.random() * 400);
      delay = Math.min(delay * 2, 16000);
      continue;
    }
    return res;
  }
}

async function upsertOne(body, token) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const payload = JSON.stringify(body);
  // Thử tạo mới; nếu đã tồn tại (409) thì cập nhật.
  let res = await apiFetch(API, { method: 'POST', headers, body: payload });
  if (res.status === 409) {
    res = await apiFetch(`${API}/${body.id}`, { method: 'PUT', headers, body: payload });
    if (res.ok) return 'updated';
  } else if (res.ok) {
    return 'added';
  }
  const txt = await res.text().catch(() => '');
  throw new Error(`HTTP ${res.status} ${txt.slice(0, 200)}`);
}

/**
 * Đồng bộ tất cả buổi học lên Google Calendar (calendar chính).
 * @param {Array} sessions danh sách buổi học.
 * @param {string} token OAuth access token có quyền calendar.events.
 * @param {(done:number,total:number)=>void} [onProgress] callback tiến độ.
 * @returns {Promise<{added:number,updated:number,failed:number,errors:string[]}>}
 */
export async function syncToGoogleCalendar(sessions, token, onProgress) {
  const result = { added: 0, updated: 0, failed: 0, errors: [] };
  let done = 0;
  // Ít luồng để tránh vượt giới hạn tốc độ ghi của Google Calendar; kết hợp
  // backoff trong apiFetch để hoàn tất mà không lỗi rate limit.
  const CONCURRENCY = 2;
  const queue = sessions.slice();

  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      try {
        const r = await upsertOne(eventBody(s), token);
        if (r === 'added') result.added++;
        else result.updated++;
      } catch (e) {
        result.failed++;
        if (result.errors.length < 5) result.errors.push(e.message || String(e));
      } finally {
        done++;
        if (onProgress) onProgress(done, sessions.length);
      }
      await sleep(120); // giãn nhịp để tránh dồn request
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sessions.length) }, worker));
  return result;
}
