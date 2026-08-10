// Khung dùng chung cho các module đang phát triển.
export default function Placeholder({ icon, title, children }) {
  return (
    <div>
      <h1>
        {icon} {title}
      </h1>
      <div className="card placeholder">{children}</div>
    </div>
  );
}
