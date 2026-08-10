// Module HOÀN CHỈNH: quản lý tiến độ công việc cá nhân (CRUD với Firestore).
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { useAuth } from '../contexts/AuthContext.jsx';

const STATUS = [
  { value: 'todo', label: 'Cần làm' },
  { value: 'doing', label: 'Đang làm' },
  { value: 'done', label: 'Hoàn thành' },
];

export default function Tasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState('all');

  // Lắng nghe real-time danh sách công việc của người dùng hiện tại.
  useEffect(() => {
    if (!user) return undefined;
    const q = query(
      collection(db, 'tasks'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [user]);

  async function addTask(e) {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    setError('');
    try {
      await addDoc(collection(db, 'tasks'), {
        uid: user.uid,
        title: text,
        status: 'todo',
        createdAt: serverTimestamp(),
      });
      setTitle('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeStatus(task, status) {
    try {
      await updateDoc(doc(db, 'tasks', task.id), { status });
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeTask(task) {
    try {
      await deleteDoc(doc(db, 'tasks', task.id));
    } catch (err) {
      setError(err.message);
    }
  }

  const visible = useMemo(
    () => (filter === 'all' ? tasks : tasks.filter((t) => t.status === filter)),
    [tasks, filter]
  );

  const counts = useMemo(
    () => ({
      all: tasks.length,
      todo: tasks.filter((t) => t.status === 'todo').length,
      doing: tasks.filter((t) => t.status === 'doing').length,
      done: tasks.filter((t) => t.status === 'done').length,
    }),
    [tasks]
  );

  return (
    <div>
      <h1>Công việc cá nhân</h1>

      <form className="inline-form" onSubmit={addTask}>
        <input
          type="text"
          placeholder="Thêm công việc mới…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">
          Thêm
        </button>
      </form>

      <div className="filter-row">
        <FilterBtn value="all" filter={filter} setFilter={setFilter} label={`Tất cả (${counts.all})`} />
        <FilterBtn value="todo" filter={filter} setFilter={setFilter} label={`Cần làm (${counts.todo})`} />
        <FilterBtn value="doing" filter={filter} setFilter={setFilter} label={`Đang làm (${counts.doing})`} />
        <FilterBtn value="done" filter={filter} setFilter={setFilter} label={`Hoàn thành (${counts.done})`} />
      </div>

      {error && <div className="error-box">{error}</div>}
      {loading ? (
        <p className="muted">Đang tải…</p>
      ) : visible.length === 0 ? (
        <p className="muted">Chưa có công việc nào.</p>
      ) : (
        <ul className="task-list">
          {visible.map((task) => (
            <li key={task.id} className={`task-item status-${task.status}`}>
              <span className="task-title">{task.title}</span>
              <div className="task-actions">
                <select
                  value={task.status}
                  onChange={(e) => changeStatus(task, e.target.value)}
                >
                  {STATUS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button className="btn btn-danger" onClick={() => removeTask(task)}>
                  Xóa
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterBtn({ value, filter, setFilter, label }) {
  return (
    <button
      className={filter === value ? 'chip active' : 'chip'}
      onClick={() => setFilter(value)}
    >
      {label}
    </button>
  );
}
