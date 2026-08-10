// Đồng bộ TKB lên Google Calendar. Để tránh trùng khi cập nhật, dùng MỘT lịch
// riêng "Lịch giảng dạy (TKB)" và XÓA SẠCH lịch đó trước mỗi lần đồng bộ, rồi
// ghi lại toàn bộ buổi học mới. Nhờ vậy không còn lẫn lịch cũ với lịch mới.

const TZ = 'Asia/Ho_Chi_Minh';
const BASE = 'https://www.googleapis.com/calendar/v3';
export const CALENDAR_NAME = 'Lịch giảng dạy (TKB)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gọi API có tự thử lại khi bị giới hạn tốc độ (403 rateLimit / 429 / 5xx).
async function apiFetch(url, opts, maxRetries = 6) {
  let delay = 800;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, opts);
    if (res.ok || res.status === 404 || res.status === 409) return res;
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

function authHeaders(token, json) {
  const h = { Authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

// Id ổn định theo lược đồ CŨ (dùng để xóa các buổi đã lỡ ghi vào Lịch chính trước đây).
function legacyEventId(s) {
  const raw = `${s.date}|${s.p1}|${s.p2}|${s.class}|${s.course}|${s.room}`;
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 * 31 + c) >>> 0;
  }
  const b = (n) => (n >>> 0).toString(32);
  return 'tkb' + b(h1) + b(h2);
}

/**
 * Xóa các buổi TKB đã lỡ ghi vào Lịch chính (primary) theo lược đồ id cũ.
 * Chỉ xóa đúng sự kiện app từng tạo (id 'tkb...'), không đụng sự kiện khác.
 */
export async function cleanupPrimary(sessions, token, onProgress) {
  let done = 0, deleted = 0;
  for (const s of sessions) {
    const res = await apiFetch(`${BASE}/calendars/primary/events/${legacyEventId(s)}`, { method: 'DELETE', headers: authHeaders(token) });
    if (res.ok) deleted++; // 404/410 = đã không còn -> bỏ qua
    done++;
    if (onProgress) onProgress(done, sessions.length);
    await sleep(100);
  }
  return { deleted };
}

function eventBody(s) {
  return {
    summary: s.lessonShort ? `${s.subject} — ${s.lessonShort}` : s.subject,
    description: s.lesson || undefined,
    location: s.room,
    start: { dateTime: `${s.date}T${s.startTime}:00`, timeZone: TZ },
    end: { dateTime: `${s.date}T${s.endTime}:00`, timeZone: TZ },
  };
}

// Xóa mọi lịch trùng tên (do người dùng sở hữu) để dọn sạch lần cập nhật trước.
async function deleteCalendarsByName(token, name) {
  const res = await apiFetch(`${BASE}/users/me/calendarList?maxResults=250`, { headers: authHeaders(token) });
  if (!res.ok) return;
  const data = await res.json().catch(() => ({}));
  const items = (data.items || []).filter((c) => c.summary === name && c.accessRole === 'owner');
  for (const it of items) {
    await apiFetch(`${BASE}/calendars/${encodeURIComponent(it.id)}`, { method: 'DELETE', headers: authHeaders(token) });
  }
}

async function createCalendar(token, name) {
  const res = await apiFetch(`${BASE}/calendars`, {
    method: 'POST', headers: authHeaders(token, true),
    body: JSON.stringify({ summary: name, timeZone: TZ }),
  });
  if (!res.ok) throw new Error(`Không tạo được lịch (HTTP ${res.status}).`);
  return (await res.json()).id;
}

/**
 * Đồng bộ danh sách buổi học lên một lịch riêng (tự tạo mới, xóa lịch cũ trùng tên).
 * @param {Array} sessions buổi học.
 * @param {string} token OAuth access token (scope calendar).
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<{added:number, failed:number, errors:string[], calendar:string}>}
 */
export async function syncToGoogleCalendar(sessions, token, onProgress) {
  // 1) Dọn lịch cũ + tạo lịch mới sạch.
  await deleteCalendarsByName(token, CALENDAR_NAME);
  const calId = await createCalendar(token, CALENDAR_NAME);
  const eventsUrl = `${BASE}/calendars/${encodeURIComponent(calId)}/events`;

  // 2) Ghi toàn bộ buổi học (lịch mới rỗng nên chỉ cần insert, không lo trùng).
  const result = { added: 0, failed: 0, errors: [], calendar: CALENDAR_NAME };
  let done = 0;
  const CONCURRENCY = 2;
  const queue = sessions.slice();

  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      try {
        const res = await apiFetch(eventsUrl, { method: 'POST', headers: authHeaders(token, true), body: JSON.stringify(eventBody(s)) });
        if (res.ok) result.added++;
        else {
          result.failed++;
          if (result.errors.length < 5) result.errors.push(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
        }
      } catch (e) {
        result.failed++;
        if (result.errors.length < 5) result.errors.push(e.message || String(e));
      } finally {
        done++;
        if (onProgress) onProgress(done, sessions.length);
      }
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sessions.length) }, worker));
  return result;
}
